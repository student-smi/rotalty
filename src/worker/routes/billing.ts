import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, gte, isNull, like } from "drizzle-orm";
import { createDb } from "../db/client";
import { businesses, paymentTransactions, platformSettings, subscriptionPlans, supportMessages } from "../db/schema";
import { requireUser } from "../middleware/auth";
import { AppError, badRequest, notFound } from "../lib/errors";
import { validate } from "../lib/validation";
import { currentUsage, getPlanForUser } from "../services/plans";
import {
  activatePayment,
  createOrder,
  isRazorpayConfigured,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "../services/razorpay";
import { getPaymentSettings, paymentMode, startUpiPayment, submitUpiPayment, upiUri } from "../services/upi-payments";
import type { AppEnv } from "../types";

const UTR = z
  .string()
  .transform((v) => v.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{10,22}$/, "Enter the 12-digit UPI transaction ID (UTR) from your payment app"));
const PROOF_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_PROOF_BYTES = 600 * 1024;

const COUNTED_PER_BUSINESS = [
  "locationsPerBusiness",
  "staffPerBusiness",
  "customersPerBusiness",
  "programsPerBusiness",
  "aiGenerationsPerMonth",
  "campaignMessagesPerMonth",
] as const;

function serializePlan(p: typeof subscriptionPlans.$inferSelect) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    pricePaise: p.pricePaise,
    intervalDays: p.intervalDays,
    limits: p.limits,
  };
}

export const billingRoutes = new Hono<AppEnv>()
  .use("*", requireUser)

  .get("/plans", async (c) => {
    const plans = await c
      .get("db")
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true))
      .orderBy(asc(subscriptionPlans.sortOrder))
      .all();
    const settings = await getPaymentSettings(c.get("db"));
    const mode = paymentMode(c.env, settings);
    return c.json({
      plans: plans.map(serializePlan),
      paymentsAvailable: mode !== "none",
      paymentMethod: mode,
      keyId: mode === "razorpay" ? (c.env.RAZORPAY_KEY_ID ?? null) : null,
    });
  })

  .get("/subscription", async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const { plan, subscription } = await getPlanForUser(db, user.id);
    const owned = await db
      .select({ id: businesses.id, name: businesses.name })
      .from(businesses)
      .where(and(eq(businesses.ownerUserId, user.id), isNull(businesses.deletedAt)))
      .all();
    const usage = await Promise.all(
      owned.map(async (b) => {
        const entries = await Promise.all(
          COUNTED_PER_BUSINESS.map(async (key) => [key, { used: await currentUsage(db, key, { businessId: b.id }), limit: plan.limits[key] }] as const),
        );
        return { businessId: b.id, name: b.name, usage: Object.fromEntries(entries) };
      }),
    );
    const expired = subscription && (subscription.status !== "active" || (subscription.currentPeriodEnd?.getTime() ?? Infinity) <= Date.now());
    return c.json({
      plan: serializePlan(plan),
      subscription: subscription
        ? { status: expired ? "expired" : subscription.status, currentPeriodEnd: subscription.currentPeriodEnd, planId: subscription.planId }
        : null,
      account: { businesses: { used: owned.length, limit: plan.limits.businesses } },
      businesses: usage,
    });
  })

  .post("/checkout", validate("json", z.object({ planCode: z.string().min(1).max(40) })), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const plan = await db
      .select()
      .from(subscriptionPlans)
      .where(and(eq(subscriptionPlans.code, c.req.valid("json").planCode), eq(subscriptionPlans.isActive, true)))
      .get();
    if (!plan) throw notFound("Plan");
    if (plan.pricePaise <= 0) throw badRequest("The Free plan doesn't need a payment");
    if (!isRazorpayConfigured(c.env)) {
      throw new AppError(503, "PAYMENTS_UNAVAILABLE", "Online payments are not configured yet. Please contact support to upgrade.");
    }
    const receipt = `sub_${crypto.randomUUID().slice(0, 30)}`;
    const order = await createOrder(c.env, {
      amountPaise: plan.pricePaise,
      receipt,
      notes: { userId: user.id, planCode: plan.code },
    });
    await db.insert(paymentTransactions).values({
      userId: user.id,
      planId: plan.id,
      orderId: order.id,
      amountPaise: plan.pricePaise,
      currency: "INR",
      status: "created",
    });
    return c.json({
      orderId: order.id,
      amountPaise: plan.pricePaise,
      currency: "INR",
      keyId: c.env.RAZORPAY_KEY_ID!,
      planName: plan.name,
      prefill: { name: user.name, email: user.email },
    });
  })

  .post(
    "/verify",
    validate("json", z.object({ orderId: z.string().min(1).max(100), paymentId: z.string().min(1).max(100), signature: z.string().min(1).max(200) })),
    async (c) => {
      const { orderId, paymentId, signature } = c.req.valid("json");
      const db = c.get("db");
      const user = c.get("user")!;
      if (!isRazorpayConfigured(c.env)) throw new AppError(503, "PAYMENTS_UNAVAILABLE", "Online payments are not configured");
      const payment = await db
        .select()
        .from(paymentTransactions)
        .where(and(eq(paymentTransactions.orderId, orderId), eq(paymentTransactions.userId, user.id)))
        .get();
      if (!payment) throw notFound("Order");
      if (!(await verifyPaymentSignature(orderId, paymentId, signature, c.env.RAZORPAY_KEY_SECRET!))) {
        throw new AppError(400, "INVALID_SIGNATURE", "Payment could not be verified");
      }
      const result = await activatePayment(db, { orderId, paymentId, source: "checkout", actorUserId: user.id });
      const { plan, subscription } = await getPlanForUser(db, user.id);
      return c.json({ status: result.status, plan: serializePlan(plan), currentPeriodEnd: subscription?.currentPeriodEnd ?? null });
    },
  )

  /** "contact" mode: the owner asks for a plan; it lands in the Super Admin Support Inbox. */
  .post("/plan-request", validate("json", z.object({ planCode: z.string().min(1).max(40) })), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const plan = await db
      .select()
      .from(subscriptionPlans)
      .where(and(eq(subscriptionPlans.code, c.req.valid("json").planCode), eq(subscriptionPlans.isActive, true)))
      .get();
    if (!plan || plan.pricePaise <= 0) throw notFound("Plan");
    const shop = await db
      .select({ name: businesses.name, phone: businesses.phone, whatsappNumber: businesses.whatsappNumber })
      .from(businesses)
      .where(and(eq(businesses.ownerUserId, user.id), isNull(businesses.deletedAt)))
      .orderBy(asc(businesses.createdAt))
      .get();
    const contact = shop?.whatsappNumber ?? shop?.phone ?? user.email;
    const subject = `Plan request: ${plan.name}`;
    // One open request per plan per day is enough; repeated taps don't flood the inbox.
    const recent = await db
      .select({ id: supportMessages.id })
      .from(supportMessages)
      .where(and(eq(supportMessages.contact, contact), eq(supportMessages.status, "open"), gte(supportMessages.createdAt, new Date(Date.now() - 86_400_000)), like(supportMessages.message, `${subject}%`)))
      .get();
    if (!recent) {
      await db.insert(supportMessages).values({
        name: user.name,
        contact,
        topic: "shop_owner",
        businessName: shop?.name ?? null,
        message: `${subject} (₹${(plan.pricePaise / 100).toLocaleString("en-IN")} / ${plan.intervalDays} days). Account: ${user.email}. Please send payment details on WhatsApp.`,
      });
    }
    return c.json({ ok: true, alreadyRequested: !!recent });
  })

  /** Manual UPI step 1: a payment reference + the UPI link/QR for the chosen plan. */
  .post("/upi/start", validate("json", z.object({ planCode: z.string().min(1).max(40) })), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const settings = await getPaymentSettings(db);
    if (paymentMode(c.env, settings) !== "upi") throw new AppError(503, "PAYMENTS_UNAVAILABLE", "UPI payments are not set up yet. Please contact support to upgrade.");
    const plan = await db
      .select()
      .from(subscriptionPlans)
      .where(and(eq(subscriptionPlans.code, c.req.valid("json").planCode), eq(subscriptionPlans.isActive, true)))
      .get();
    if (!plan) throw notFound("Plan");
    if (plan.pricePaise <= 0) throw badRequest("The Free plan doesn't need a payment");
    const payment = await startUpiPayment(db, user.id, plan);
    const payeeName = settings.upiPayeeName ?? "Repeatly";
    return c.json({
      reference: payment.orderId,
      amountPaise: payment.amountPaise,
      planName: plan.name,
      upiId: settings.upiId,
      payeeName,
      upiUri: upiUri({ upiId: settings.upiId!, payeeName, amountPaise: payment.amountPaise, reference: payment.orderId, note: `${plan.name} plan ${payment.orderId}` }),
    });
  })

  /** Manual UPI step 2: the owner enters the UTR (and optionally a screenshot). Multipart form. */
  .post("/upi/submit", async (c) => {
    const db = c.get("db");
    const form = await c.req.formData().catch(() => null);
    if (!form) throw badRequest("Send the payment details as a form");
    const reference = String(form.get("reference") ?? "").trim();
    const utr = UTR.safeParse(String(form.get("utr") ?? ""));
    if (!/^RP-[A-Z0-9]{6}$/.test(reference)) throw badRequest("Invalid payment reference");
    if (!utr.success) throw badRequest("Please check the transaction ID", [{ path: "utr", message: utr.error.issues[0]!.message }]);
    let proof: { contentType: string; data: Uint8Array } | undefined;
    const file = form.get("proof");
    if (file instanceof File && file.size > 0) {
      if (!PROOF_TYPES.includes(file.type)) throw badRequest("Screenshot must be a PNG, JPEG or WebP image", [{ path: "proof", message: "Unsupported image" }]);
      if (file.size > MAX_PROOF_BYTES) throw badRequest("Screenshot is too large", [{ path: "proof", message: "Max 600 KB" }]);
      proof = { contentType: file.type, data: new Uint8Array(await file.arrayBuffer()) };
    }
    const result = await submitUpiPayment(db, await getPaymentSettings(db), c.get("user")!.id, { reference, utr: utr.data, proof });
    return c.json({ status: "submitted", provisionalUntil: result.provisionalUntil });
  })

  .get("/payments", async (c) => {
    const rows = await c
      .get("db")
      .select({
        id: paymentTransactions.id,
        orderId: paymentTransactions.orderId,
        paymentId: paymentTransactions.paymentId,
        amountPaise: paymentTransactions.amountPaise,
        currency: paymentTransactions.currency,
        status: paymentTransactions.status,
        failureReason: paymentTransactions.failureReason,
        paidAt: paymentTransactions.paidAt,
        createdAt: paymentTransactions.createdAt,
        provider: paymentTransactions.provider,
        submittedAt: paymentTransactions.submittedAt,
        provisionalUntil: paymentTransactions.provisionalUntil,
        planName: subscriptionPlans.name,
      })
      .from(paymentTransactions)
      .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, paymentTransactions.planId))
      .where(eq(paymentTransactions.userId, c.get("user")!.id))
      .orderBy(desc(paymentTransactions.createdAt))
      .limit(50)
      .all();
    return c.json({ payments: rows });
  })

  .get("/platform-status", async (c) => {
    const row = await c.get("db").select().from(platformSettings).where(eq(platformSettings.key, "maintenanceMessage")).get();
    return c.json({ maintenanceMessage: typeof row?.value === "string" && row.value ? row.value : null });
  });

interface RazorpayWebhook {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; error_description?: string; error_reason?: string } };
    order?: { entity?: { id?: string } };
  };
}

export const razorpayWebhookRoutes = new Hono<AppEnv>().post("/", async (c) => {
  const secret = c.env.RAZORPAY_WEBHOOK_SECRET;
  const raw = await c.req.text();
  if (!secret || !(await verifyWebhookSignature(raw, c.req.header("x-razorpay-signature"), secret))) {
    return c.json({ error: { code: "INVALID_SIGNATURE", message: "Invalid signature" } }, 401);
  }
  let body: RazorpayWebhook;
  try {
    body = JSON.parse(raw) as RazorpayWebhook;
  } catch {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON" } }, 400);
  }
  const db = createDb(c.env.DB);
  const payment = body.payload?.payment?.entity;
  const orderId = payment?.order_id ?? body.payload?.order?.entity?.id;

  if ((body.event === "payment.captured" || body.event === "order.paid") && orderId && payment?.id) {
    const known = await db.select({ id: paymentTransactions.id }).from(paymentTransactions).where(eq(paymentTransactions.orderId, orderId)).get();
    if (!known) return c.json({ ok: true, ignored: "unknown_order" });
    const result = await activatePayment(db, { orderId, paymentId: payment.id, source: "webhook" });
    return c.json({ ok: true, status: result.status });
  }

  if (body.event === "payment.failed" && orderId) {
    await db
      .update(paymentTransactions)
      .set({ status: "failed", failureReason: (payment?.error_description ?? payment?.error_reason ?? "Payment failed").slice(0, 300) })
      .where(and(eq(paymentTransactions.orderId, orderId), eq(paymentTransactions.status, "created")));
    return c.json({ ok: true });
  }

  return c.json({ ok: true, ignored: body.event ?? "unknown" });
});

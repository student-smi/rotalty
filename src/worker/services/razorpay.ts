import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { auditLogs, paymentTransactions, subscriptionPlans, subscriptions } from "../db/schema";
import { AppError } from "../lib/errors";
import { timingSafeEqual } from "../lib/crypto";

const encoder = new TextEncoder();

export function isRazorpayConfigured(env: Env) {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

export async function createOrder(
  env: Env,
  input: { amountPaise: number; receipt: string; notes: Record<string, string> },
): Promise<RazorpayOrder> {
  if (!isRazorpayConfigured(env)) throw new AppError(503, "PAYMENTS_UNAVAILABLE", "Online payments are not configured yet");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: input.amountPaise, currency: "INR", receipt: input.receipt, notes: input.notes }),
  });
  if (!res.ok) {
    console.error("Razorpay order failed", res.status, await res.text().catch(() => ""));
    throw new AppError(502, "PAYMENT_PROVIDER_ERROR", "Could not start the payment. Please try again.");
  }
  return (await res.json()) as RazorpayOrder;
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqualHex(a: string, b: string) {
  return timingSafeEqual(encoder.encode(a.toLowerCase()), encoder.encode(b.toLowerCase()));
}

export async function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, keySecret: string) {
  if (!signature || !/^[0-9a-f]+$/i.test(signature)) return false;
  return safeEqualHex(await hmacHex(keySecret, `${orderId}|${paymentId}`), signature);
}

export async function verifyWebhookSignature(rawBody: string, header: string | undefined | null, webhookSecret: string) {
  if (!header || !/^[0-9a-f]+$/i.test(header)) return false;
  return safeEqualHex(await hmacHex(webhookSecret, rawBody), header);
}

function isUniqueViolation(err: unknown) {
  let e: unknown = err;
  for (let i = 0; e && i < 4; i++) {
    if (String((e as Error).message ?? e).includes("UNIQUE constraint failed")) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export type ActivationResult = { status: "activated" | "already_processed"; periodEnd: Date | null };

/**
 * Marks an order paid and extends/switches the owner's subscription. Idempotent: the UNIQUE payment_id index
 * plus the `status = 'created'` guard ensure a payment activates at most once (verify + webhook may both arrive).
 */
export async function activatePayment(
  db: DB,
  input: { orderId: string; paymentId: string; source: "checkout" | "webhook"; actorUserId?: string | null },
): Promise<ActivationResult> {
  const row = await db
    .select({ payment: paymentTransactions, plan: subscriptionPlans })
    .from(paymentTransactions)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, paymentTransactions.planId))
    .where(eq(paymentTransactions.orderId, input.orderId))
    .get();
  if (!row) throw new AppError(404, "NOT_FOUND", "Order not found");
  const { payment, plan } = row;
  if (payment.status === "paid") return { status: "already_processed", periodEnd: null };

  const existing = await db.select().from(subscriptions).where(eq(subscriptions.userId, payment.userId)).get();
  const now = Date.now();
  const activeSame =
    existing &&
    existing.status === "active" &&
    existing.planId === plan.id &&
    existing.currentPeriodEnd &&
    existing.currentPeriodEnd.getTime() > now;
  const base = activeSame ? existing.currentPeriodEnd!.getTime() : now;
  const periodEnd = new Date(base + plan.intervalDays * 86_400_000);
  const paidAt = new Date();

  try {
    await db.batch([
      db
        .update(paymentTransactions)
        .set({ status: "paid", paymentId: input.paymentId, paidAt, failureReason: null })
        .where(and(eq(paymentTransactions.id, payment.id), sql`${paymentTransactions.status} <> 'paid'`)),
      db
        .insert(subscriptions)
        .values({ userId: payment.userId, planId: plan.id, status: "active", currentPeriodEnd: periodEnd })
        .onConflictDoUpdate({
          target: subscriptions.userId,
          set: { planId: plan.id, status: "active", currentPeriodEnd: periodEnd, updatedAt: paidAt },
        }),
      db.insert(auditLogs).values({
        actorUserId: input.actorUserId ?? null,
        action: "billing.payment_activated",
        entityType: "subscription",
        entityId: payment.userId,
        metadata: { orderId: input.orderId, paymentId: input.paymentId, plan: plan.code, periodEnd: periodEnd.toISOString(), source: input.source },
      }),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "already_processed", periodEnd: null };
    throw err;
  }
  // A concurrent activation may have won between our read and write; the guard above made our update a no-op
  // but the subscription upsert still ran. Re-check so the second caller reports correctly.
  const after = await db.select({ paymentId: paymentTransactions.paymentId }).from(paymentTransactions).where(eq(paymentTransactions.id, payment.id)).get();
  if (after?.paymentId !== input.paymentId) return { status: "already_processed", periodEnd: null };
  return { status: "activated", periodEnd };
}

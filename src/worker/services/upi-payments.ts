import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { auditLogs, paymentProofs, paymentTransactions, platformSettings, subscriptionPlans, subscriptions } from "../db/schema";
import { AppError } from "../lib/errors";
import { getPlanForUser } from "./plans";
import { isRazorpayConfigured } from "./razorpay";

/**
 * Manual UPI payments: the owner pays our UPI ID from any UPI app (standard NPCI `upi://pay` link/QR),
 * enters the UTR, and a Super Admin approves it after checking the bank statement. No gateway, no fees.
 * Rows live in payment_transactions with provider "upi_manual":
 *   status "created" + no UTR  → waiting for payment
 *   status "created" + UTR     → submitted, waiting for a Super Admin
 *   status "paid"              → approved
 *   status "failed"            → rejected (failureReason says why)
 */
export const UPI_PROVIDER = "upi_manual";
const PROVISIONAL_MS = 48 * 3_600_000;
const DAY = 86_400_000;

export interface PaymentSettings {
  upiId: string | null;
  upiPayeeName: string | null;
  paymentMethod: "upi" | "razorpay";
  provisionalAccess: boolean;
}

export async function getPaymentSettings(db: DB): Promise<PaymentSettings> {
  const rows = await db.select().from(platformSettings).all();
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    upiId: typeof v.upiId === "string" && v.upiId ? v.upiId : null,
    upiPayeeName: typeof v.upiPayeeName === "string" && v.upiPayeeName ? v.upiPayeeName : null,
    paymentMethod: v.paymentMethod === "razorpay" ? "razorpay" : "upi",
    provisionalAccess: v.provisionalAccess !== false,
  };
}

/** Which checkout the owner sees. Razorpay only if chosen *and* configured; UPI only once a UPI ID is set. */
export function paymentMode(env: Env, s: PaymentSettings): "upi" | "razorpay" | "none" {
  if (s.paymentMethod === "razorpay" && isRazorpayConfigured(env)) return "razorpay";
  if (s.upiId) return "upi";
  if (isRazorpayConfigured(env)) return "razorpay";
  return "none";
}

/** NPCI UPI deep link: opens GPay / PhonePe / Paytm / BHIM with the amount and note filled in. */
export function upiUri(s: { upiId: string; payeeName: string; amountPaise: number; reference: string; note: string }) {
  const q = new URLSearchParams({
    pa: s.upiId,
    pn: s.payeeName,
    am: (s.amountPaise / 100).toFixed(2),
    cu: "INR",
    tn: s.note.slice(0, 50),
    tr: s.reference,
  });
  return `upi://pay?${q.toString().replace(/\+/g, "%20")}`;
}

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I, easy to read out
function newReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `RP-${Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("")}`;
}

export async function startUpiPayment(db: DB, userId: string, plan: typeof subscriptionPlans.$inferSelect) {
  // Re-use an unpaid reference for the same plan from the last day, so refreshing doesn't create new ones.
  const existing = await db
    .select()
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.userId, userId),
        eq(paymentTransactions.planId, plan.id),
        eq(paymentTransactions.provider, UPI_PROVIDER),
        eq(paymentTransactions.status, "created"),
        isNull(paymentTransactions.submittedAt),
        gte(paymentTransactions.createdAt, new Date(Date.now() - DAY)),
      ),
    )
    .orderBy(desc(paymentTransactions.createdAt))
    .get();
  if (existing) return existing;
  const [row] = await db
    .insert(paymentTransactions)
    .values({ userId, planId: plan.id, provider: UPI_PROVIDER, orderId: newReference(), amountPaise: plan.pricePaise, currency: "INR", status: "created" })
    .returning();
  return row!;
}

const isUnique = (err: unknown) => /UNIQUE constraint failed/i.test(String((err as Error)?.message ?? err) + String((err as { cause?: unknown })?.cause ?? ""));

export async function submitUpiPayment(
  db: DB,
  settings: PaymentSettings,
  userId: string,
  input: { reference: string; utr: string; proof?: { contentType: string; data: Uint8Array } },
) {
  const payment = await db
    .select()
    .from(paymentTransactions)
    .where(and(eq(paymentTransactions.orderId, input.reference), eq(paymentTransactions.userId, userId), eq(paymentTransactions.provider, UPI_PROVIDER)))
    .get();
  if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found. Please start again.");
  if (payment.status !== "created" || payment.submittedAt) throw new AppError(409, "ALREADY_SUBMITTED", "This payment was already submitted.");

  // 48-hour access while we verify — only for accounts not already on a paid plan, and only once ever.
  const now = Date.now();
  const { subscription } = await getPlanForUser(db, userId);
  const onPaidPlan = !!subscription && subscription.status === "active" && (!subscription.currentPeriodEnd || subscription.currentPeriodEnd.getTime() > now);
  const hadProvisional = await db
    .select({ id: paymentTransactions.id })
    .from(paymentTransactions)
    .where(and(eq(paymentTransactions.userId, userId), isNotNull(paymentTransactions.provisionalUntil)))
    .get();
  const provisionalUntil = settings.provisionalAccess && !onPaidPlan && !hadProvisional ? new Date(now + PROVISIONAL_MS) : null;

  try {
    await db.batch([
      db
        .update(paymentTransactions)
        .set({ paymentId: input.utr, submittedAt: new Date(now), provisionalUntil, updatedAt: new Date(now) })
        .where(and(eq(paymentTransactions.id, payment.id), isNull(paymentTransactions.submittedAt))),
      ...(input.proof ? [db.insert(paymentProofs).values({ paymentId: payment.id, contentType: input.proof.contentType, data: Buffer.from(input.proof.data) })] : []),
      ...(provisionalUntil
        ? [
            db
              .insert(subscriptions)
              .values({ userId, planId: payment.planId, status: "active", currentPeriodEnd: provisionalUntil })
              .onConflictDoUpdate({ target: subscriptions.userId, set: { planId: payment.planId, status: "active", currentPeriodEnd: provisionalUntil, updatedAt: new Date(now) } }),
          ]
        : []),
      db.insert(auditLogs).values({
        actorUserId: userId,
        action: "billing.upi_submitted",
        entityType: "payment",
        entityId: payment.id,
        metadata: { reference: input.reference, provisional: !!provisionalUntil, proof: !!input.proof },
      }),
    ]);
  } catch (err) {
    if (isUnique(err)) throw new AppError(409, "UTR_USED", "This transaction ID has already been submitted. Please check the number.");
    throw err;
  }
  return { provisionalUntil };
}

async function loadSubmitted(db: DB, paymentId: string) {
  const row = await db
    .select({ payment: paymentTransactions, plan: subscriptionPlans })
    .from(paymentTransactions)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, paymentTransactions.planId))
    .where(and(eq(paymentTransactions.id, paymentId), eq(paymentTransactions.provider, UPI_PROVIDER)))
    .get();
  if (!row) throw new AppError(404, "NOT_FOUND", "Payment not found");
  if (row.payment.status !== "created" || !row.payment.submittedAt) throw new AppError(409, "NOT_PENDING", "This payment is not waiting for review");
  return row;
}

/** Super Admin confirmed the money arrived: start (or extend) the plan for its full period. */
export async function approveUpiPayment(db: DB, paymentId: string, adminId: string) {
  const { payment, plan } = await loadSubmitted(db, paymentId);
  const existing = await db.select().from(subscriptions).where(eq(subscriptions.userId, payment.userId)).get();
  const now = Date.now();
  // Extend a genuinely paid period of the same plan; the 48-hour access doesn't count as paid time.
  const onlyProvisional = !!payment.provisionalUntil && existing?.currentPeriodEnd?.getTime() === payment.provisionalUntil.getTime();
  const extend = existing && existing.status === "active" && existing.planId === plan.id && existing.currentPeriodEnd && existing.currentPeriodEnd.getTime() > now && !onlyProvisional;
  const periodEnd = new Date((extend ? existing!.currentPeriodEnd!.getTime() : now) + plan.intervalDays * DAY);
  await db.batch([
    db
      .update(paymentTransactions)
      .set({ status: "paid", paidAt: new Date(now), reviewedByUserId: adminId, failureReason: null, updatedAt: new Date(now) })
      .where(and(eq(paymentTransactions.id, payment.id), eq(paymentTransactions.status, "created"))),
    db
      .insert(subscriptions)
      .values({ userId: payment.userId, planId: plan.id, status: "active", currentPeriodEnd: periodEnd })
      .onConflictDoUpdate({ target: subscriptions.userId, set: { planId: plan.id, status: "active", currentPeriodEnd: periodEnd, updatedAt: new Date(now) } }),
    db.insert(auditLogs).values({
      actorUserId: adminId,
      action: "billing.upi_approved",
      entityType: "payment",
      entityId: payment.id,
      metadata: { reference: payment.orderId, utr: payment.paymentId, plan: plan.code, periodEnd: periodEnd.toISOString() },
    }),
  ]);
  return { periodEnd };
}

/** Super Admin couldn't find the money: mark rejected and take back the 48-hour access if it's still the active one. */
export async function rejectUpiPayment(db: DB, paymentId: string, adminId: string, reason: string) {
  const { payment } = await loadSubmitted(db, paymentId);
  const existing = await db.select().from(subscriptions).where(eq(subscriptions.userId, payment.userId)).get();
  const revoke =
    !!payment.provisionalUntil && !!existing && existing.planId === payment.planId && existing.currentPeriodEnd?.getTime() === payment.provisionalUntil.getTime();
  const now = new Date();
  await db.batch([
    db
      .update(paymentTransactions)
      .set({ status: "failed", failureReason: reason, reviewedByUserId: adminId, updatedAt: now })
      .where(and(eq(paymentTransactions.id, payment.id), eq(paymentTransactions.status, "created"))),
    ...(revoke ? [db.update(subscriptions).set({ status: "expired", currentPeriodEnd: now, updatedAt: now }).where(eq(subscriptions.userId, payment.userId))] : []),
    db.insert(auditLogs).values({
      actorUserId: adminId,
      action: "billing.upi_rejected",
      entityType: "payment",
      entityId: payment.id,
      metadata: { reference: payment.orderId, utr: payment.paymentId, reason, provisionalRevoked: revoke },
    }),
  ]);
  return { provisionalRevoked: revoke };
}

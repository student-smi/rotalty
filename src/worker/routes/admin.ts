import { Hono } from "hono";
import { z } from "zod";
import { and, asc, count, desc, eq, isNull, like, lt, or } from "drizzle-orm";
import {
  businesses,
  businessStaff,
  customers,
  loyaltyPrograms,
  platformSettings,
  stampTransactions,
  subscriptionPlans,
  subscriptions,
  users,
} from "../db/schema";
import { requireSuperAdmin } from "../middleware/auth";
import { auditInsert } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { validate } from "../lib/validation";
import { IST_OFFSET_MS, istDayStart, istMonthStart } from "../../shared/domain";
import type { AppEnv } from "../types";

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
const PAGE_SIZE = 25;
const DAY_MS = 86_400_000;

const limitNumber = z.number().int().min(0).max(1_000_000_000).nullable();
const planLimitsSchema = z.object({
  businesses: limitNumber,
  locationsPerBusiness: limitNumber,
  staffPerBusiness: limitNumber,
  customersPerBusiness: limitNumber,
  programsPerBusiness: limitNumber,
  aiGenerationsPerMonth: limitNumber,
  campaignMessagesPerMonth: limitNumber,
  nfc: z.boolean(),
  marketing: z.boolean(),
  advancedAnalytics: z.boolean(),
});

const planUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  pricePaise: z.number().int().min(0).max(100_000_000).optional(),
  intervalDays: z.number().int().min(1).max(366).optional(),
  isActive: z.boolean().optional(),
  limits: planLimitsSchema.optional(),
});

const settingsSchema = z.object({
  maintenanceMessage: z.string().trim().max(300).nullable().optional(),
  signupsEnabled: z.boolean().optional(),
});

const SETTINGS_DEFAULTS = { maintenanceMessage: null as string | null, signupsEnabled: true };

const istMonth = (col: string) => `strftime('%Y-%m', (${col} + ${IST_OFFSET_MS}) / 1000, 'unixepoch')`;
const istDay = (col: string) => `date((${col} + ${IST_OFFSET_MS}) / 1000, 'unixepoch')`;

async function one<T>(stmt: D1PreparedStatement) {
  return (await stmt.first<T>()) as T;
}
async function rows<T>(stmt: D1PreparedStatement) {
  return (await stmt.all<T>()).results;
}

export const adminRoutes = new Hono<AppEnv>()
  .use("*", requireSuperAdmin)

  .get("/overview", async (c) => {
    const db = c.get("db");
    const D1 = c.env.DB;
    const [biz, usr] = await db.batch([
      db
        .select({ status: businesses.status, n: count() })
        .from(businesses)
        .where(isNull(businesses.deletedAt))
        .groupBy(businesses.status),
      db.select({ n: count() }).from(users),
    ]);
    const byStatus = Object.fromEntries(biz.map((r) => [r.status, r.n]));
    const today = istDayStart().getTime();
    const month = istMonthStart().getTime();
    const [cust, cards, txToday, revenue, ai, subs] = await Promise.all([
      one<{ n: number }>(D1.prepare("SELECT count(*) AS n FROM customers WHERE deleted_at IS NULL")),
      one<{ n: number }>(D1.prepare("SELECT count(*) AS n FROM customer_cards")),
      one<{ n: number }>(D1.prepare("SELECT count(*) AS n FROM stamp_transactions WHERE created_at >= ?1").bind(today)),
      one<{ n: number | null }>(D1.prepare("SELECT sum(amount_paise) AS n FROM payment_transactions WHERE status = 'paid' AND paid_at >= ?1").bind(month)),
      one<{ n: number | null }>(D1.prepare("SELECT sum(cost_micro_usd) AS n FROM ai_usage_logs WHERE created_at >= ?1").bind(month)),
      rows<{ code: string; name: string; n: number }>(
        D1.prepare(
          `SELECT p.code, p.name, count(*) AS n FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
           WHERE s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > ?1) AND p.price_paise > 0
           GROUP BY p.code, p.name ORDER BY p.sort_order`,
        ).bind(Date.now()),
      ),
    ]);
    return c.json({
      businesses: { active: byStatus.active ?? 0, suspended: byStatus.suspended ?? 0 },
      users: usr[0]?.n ?? 0,
      customers: cust?.n ?? 0,
      cards: cards?.n ?? 0,
      transactionsToday: txToday?.n ?? 0,
      revenueThisMonthPaise: revenue?.n ?? 0,
      aiCostThisMonthMicroUsd: ai?.n ?? 0,
      activePaidSubscriptions: subs,
    });
  })

  .get("/businesses", validate("query", listQuery), async (c) => {
    const { q, status, page } = c.req.valid("query");
    const db = c.get("db");
    const pattern = q ? `%${q.replace(/[%_]/g, "")}%` : null;
    const where = and(
      isNull(businesses.deletedAt),
      status ? eq(businesses.status, status) : undefined,
      pattern ? or(like(businesses.name, pattern), like(users.email, pattern), like(businesses.city, pattern)) : undefined,
    );
    const staffCount = db
      .select({ businessId: businessStaff.businessId, n: count().as("n") })
      .from(businessStaff)
      .where(eq(businessStaff.status, "active"))
      .groupBy(businessStaff.businessId)
      .as("staff_count");

    const result = await db
      .select({
        id: businesses.id,
        name: businesses.name,
        slug: businesses.slug,
        category: businesses.category,
        city: businesses.city,
        status: businesses.status,
        suspendedReason: businesses.suspendedReason,
        createdAt: businesses.createdAt,
        ownerEmail: users.email,
        ownerName: users.name,
        staffCount: staffCount.n,
      })
      .from(businesses)
      .innerJoin(users, eq(users.id, businesses.ownerUserId))
      .leftJoin(staffCount, eq(staffCount.businessId, businesses.id))
      .where(where)
      .orderBy(desc(businesses.createdAt))
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE)
      .all();
    return c.json({ businesses: result.slice(0, PAGE_SIZE), hasMore: result.length > PAGE_SIZE, page });
  })

  .patch(
    "/businesses/:id/status",
    validate(
      "json",
      z.object({ status: z.enum(["active", "suspended"]), reason: z.string().trim().max(300).optional() }),
    ),
    async (c) => {
      const { status, reason } = c.req.valid("json");
      const db = c.get("db");
      const id = c.req.param("id");
      const biz = await db
        .select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.id, id), isNull(businesses.deletedAt)))
        .get();
      if (!biz) throw notFound("Business");
      await db.batch([
        db
          .update(businesses)
          .set({ status, suspendedReason: status === "suspended" ? (reason ?? null) : null })
          .where(eq(businesses.id, id)),
        auditInsert(c, {
          businessId: id,
          action: status === "suspended" ? "admin.business_suspended" : "admin.business_activated",
          entityType: "business",
          entityId: id,
          metadata: { reason },
        }),
      ]);
      return c.json({ ok: true });
    },
  )

  .get(
    "/subscriptions",
    validate("query", z.object({ q: z.string().trim().max(80).optional(), page: z.coerce.number().int().min(1).default(1) })),
    async (c) => {
      const { q, page } = c.req.valid("query");
      const pattern = q ? `%${q.replace(/[%_]/g, "")}%` : null;
      const result = await c
        .get("db")
        .select({
          userId: subscriptions.userId,
          email: users.email,
          name: users.name,
          planCode: subscriptionPlans.code,
          planName: subscriptionPlans.name,
          status: subscriptions.status,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          updatedAt: subscriptions.updatedAt,
        })
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
        .where(pattern ? or(like(users.email, pattern), like(users.name, pattern)) : undefined)
        .orderBy(desc(subscriptions.updatedAt))
        .limit(PAGE_SIZE + 1)
        .offset((page - 1) * PAGE_SIZE)
        .all();
      return c.json({ subscriptions: result.slice(0, PAGE_SIZE), hasMore: result.length > PAGE_SIZE, page });
    },
  )

  .put(
    "/subscriptions/:userId",
    validate("json", z.object({ planCode: z.string().min(1).max(40), days: z.number().int().min(1).max(3660) })),
    async (c) => {
      const { planCode, days } = c.req.valid("json");
      const db = c.get("db");
      const userId = c.req.param("userId");
      const [user, plan] = await Promise.all([
        db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get(),
        db.select().from(subscriptionPlans).where(eq(subscriptionPlans.code, planCode)).get(),
      ]);
      if (!user) throw notFound("User");
      if (!plan) throw notFound("Plan");
      const periodEnd = new Date(Date.now() + days * DAY_MS);
      await db.batch([
        db
          .insert(subscriptions)
          .values({ userId, planId: plan.id, status: "active", currentPeriodEnd: periodEnd })
          .onConflictDoUpdate({
            target: subscriptions.userId,
            set: { planId: plan.id, status: "active", currentPeriodEnd: periodEnd, updatedAt: new Date() },
          }),
        auditInsert(c, {
          action: "admin.subscription_granted",
          entityType: "subscription",
          entityId: userId,
          metadata: { planCode, days, periodEnd: periodEnd.toISOString() },
        }),
      ]);
      return c.json({ ok: true, currentPeriodEnd: periodEnd });
    },
  )

  .get("/revenue", async (c) => {
    const D1 = c.env.DB;
    const now = new Date(Date.now() + IST_OFFSET_MS);
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    const start = new Date(Date.UTC(Number(months[0]!.slice(0, 4)), Number(months[0]!.slice(5)) - 1, 1) - IST_OFFSET_MS).getTime();
    const [byMonth, byPlan] = await Promise.all([
      rows<{ month: string; amount: number; payments: number }>(
        D1.prepare(
          `SELECT ${istMonth("paid_at")} AS month, sum(amount_paise) AS amount, count(*) AS payments
           FROM payment_transactions WHERE status = 'paid' AND paid_at >= ?1 GROUP BY month`,
        ).bind(start),
      ),
      rows<{ code: string; name: string; amount: number; payments: number }>(
        D1.prepare(
          `SELECT p.code, p.name, sum(t.amount_paise) AS amount, count(*) AS payments FROM payment_transactions t
           JOIN subscription_plans p ON p.id = t.plan_id WHERE t.status = 'paid' AND t.paid_at >= ?1
           GROUP BY p.code, p.name ORDER BY amount DESC`,
        ).bind(start),
      ),
    ]);
    const map = new Map(byMonth.map((m) => [m.month, m]));
    return c.json({
      months: months.map((m) => ({ month: m, amountPaise: map.get(m)?.amount ?? 0, payments: map.get(m)?.payments ?? 0 })),
      byPlan: byPlan.map((p) => ({ code: p.code, name: p.name, amountPaise: p.amount, payments: p.payments })),
      totalPaise: byMonth.reduce((s, m) => s + m.amount, 0),
    });
  })

  .get("/ai-usage", validate("query", z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })), async (c) => {
    const { days } = c.req.valid("query");
    const D1 = c.env.DB;
    const since = istDayStart().getTime() - (days - 1) * DAY_MS;
    const [totals, byBusiness, daily] = await Promise.all([
      one<{ calls: number; errors: number | null; input: number | null; output: number | null; cost: number | null }>(
        D1.prepare(
          `SELECT count(*) AS calls, sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
           sum(input_tokens) AS input, sum(output_tokens) AS output, sum(cost_micro_usd) AS cost
           FROM ai_usage_logs WHERE created_at >= ?1`,
        ).bind(since),
      ),
      rows<{ businessId: string | null; name: string | null; calls: number; cost: number | null; errors: number | null }>(
        D1.prepare(
          `SELECT a.business_id AS businessId, b.name AS name, count(*) AS calls, sum(a.cost_micro_usd) AS cost,
           sum(CASE WHEN a.status = 'error' THEN 1 ELSE 0 END) AS errors
           FROM ai_usage_logs a LEFT JOIN businesses b ON b.id = a.business_id
           WHERE a.created_at >= ?1 GROUP BY a.business_id ORDER BY calls DESC LIMIT 20`,
        ).bind(since),
      ),
      rows<{ day: string; calls: number; cost: number | null }>(
        D1.prepare(
          `SELECT ${istDay("created_at")} AS day, count(*) AS calls, sum(cost_micro_usd) AS cost
           FROM ai_usage_logs WHERE created_at >= ?1 GROUP BY day ORDER BY day`,
        ).bind(since),
      ),
    ]);
    const calls = totals?.calls ?? 0;
    return c.json({
      days,
      totals: {
        calls,
        errors: totals?.errors ?? 0,
        errorRate: calls ? Math.round(((totals?.errors ?? 0) / calls) * 1000) / 10 : 0,
        inputTokens: totals?.input ?? 0,
        outputTokens: totals?.output ?? 0,
        costMicroUsd: totals?.cost ?? 0,
      },
      byBusiness: byBusiness.map((b) => ({ ...b, cost: b.cost ?? 0, errors: b.errors ?? 0 })),
      daily: daily.map((d) => ({ ...d, cost: d.cost ?? 0 })),
    });
  })

  .get(
    "/transactions",
    validate(
      "query",
      z.object({
        businessId: z.string().uuid().optional(),
        type: z.enum(["earn", "redeem", "adjust"]).optional(),
        before: z.coerce.number().int().optional(),
      }),
    ),
    async (c) => {
      const q = c.req.valid("query");
      const result = await c
        .get("db")
        .select({
          id: stampTransactions.id,
          type: stampTransactions.type,
          points: stampTransactions.points,
          channel: stampTransactions.channel,
          createdAt: stampTransactions.createdAt,
          businessId: stampTransactions.businessId,
          businessName: businesses.name,
          customerName: customers.name,
          programName: loyaltyPrograms.name,
          staffEmail: users.email,
        })
        .from(stampTransactions)
        .innerJoin(businesses, eq(businesses.id, stampTransactions.businessId))
        .innerJoin(customers, eq(customers.id, stampTransactions.customerId))
        .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, stampTransactions.programId))
        .leftJoin(users, eq(users.id, stampTransactions.actorUserId))
        .where(
          and(
            q.businessId ? eq(stampTransactions.businessId, q.businessId) : undefined,
            q.type ? eq(stampTransactions.type, q.type) : undefined,
            q.before ? lt(stampTransactions.createdAt, new Date(q.before)) : undefined,
          ),
        )
        .orderBy(desc(stampTransactions.createdAt))
        .limit(51)
        .all();
      const page = result.slice(0, 50);
      return c.json({ transactions: page, nextBefore: result.length > 50 ? page.at(-1)!.createdAt.getTime() : null });
    },
  )

  .get("/suspicious", async (c) => {
    const D1 = c.env.DB;
    const since = Date.now() - DAY_MS;
    const [staffBursts, failingCards, duplicateBusinesses, joinSpree] = await Promise.all([
      rows<{ userId: string; email: string | null; businessId: string; businessName: string; hour: string; points: number }>(
        D1.prepare(
          `SELECT t.actor_user_id AS userId, u.email AS email, t.business_id AS businessId, b.name AS businessName,
             strftime('%Y-%m-%d %H:00', t.created_at / 1000, 'unixepoch') AS hour, count(*) AS points
           FROM stamp_transactions t JOIN businesses b ON b.id = t.business_id LEFT JOIN users u ON u.id = t.actor_user_id
           WHERE t.type = 'earn' AND t.created_at >= ?1 AND t.actor_user_id IS NOT NULL
           GROUP BY t.actor_user_id, t.business_id, hour HAVING count(*) > 30 ORDER BY points DESC LIMIT 50`,
        ).bind(since),
      ),
      rows<{ cardId: string; businessId: string; businessName: string; failures: number }>(
        D1.prepare(
          `SELECT e.card_id AS cardId, e.business_id AS businessId, b.name AS businessName, count(*) AS failures
           FROM interaction_events e JOIN businesses b ON b.id = e.business_id
           WHERE e.type = 'issue_failed' AND e.card_id IS NOT NULL AND e.created_at >= ?1
           GROUP BY e.card_id, e.business_id HAVING count(*) >= 5 ORDER BY failures DESC LIMIT 50`,
        ).bind(since),
      ),
      rows<{ businessId: string; businessName: string; duplicates: number }>(
        D1.prepare(
          `SELECT e.business_id AS businessId, b.name AS businessName, count(*) AS duplicates
           FROM interaction_events e JOIN businesses b ON b.id = e.business_id
           WHERE e.type = 'issue_failed' AND e.reason = 'DUPLICATE' AND e.created_at >= ?1
           GROUP BY e.business_id HAVING count(*) >= 20 ORDER BY duplicates DESC LIMIT 50`,
        ).bind(since),
      ),
      rows<{ customerId: string; name: string; businesses: number }>(
        D1.prepare(
          `SELECT cc.customer_id AS customerId, cu.name AS name, count(DISTINCT cc.business_id) AS businesses
           FROM customer_cards cc JOIN customers cu ON cu.id = cc.customer_id
           WHERE cc.created_at >= ?1 GROUP BY cc.customer_id HAVING count(DISTINCT cc.business_id) >= 10
           ORDER BY businesses DESC LIMIT 50`,
        ).bind(since),
      ),
    ]);
    const items = [
      ...staffBursts.map((s) => ({
        kind: "staff_burst" as const,
        severity: "high" as const,
        reason: `Staff ${s.email ?? s.userId} issued ${s.points} points in one hour (${s.hour} UTC)`,
        businessId: s.businessId,
        businessName: s.businessName,
        details: s,
      })),
      ...failingCards.map((f) => ({
        kind: "card_failures" as const,
        severity: "medium" as const,
        reason: `Card had ${f.failures} failed point attempts in 24h`,
        businessId: f.businessId,
        businessName: f.businessName,
        details: f,
      })),
      ...duplicateBusinesses.map((d) => ({
        kind: "duplicate_spike" as const,
        severity: "medium" as const,
        reason: `${d.duplicates} duplicate scan attempts in 24h`,
        businessId: d.businessId,
        businessName: d.businessName,
        details: d,
      })),
      ...joinSpree.map((j) => ({
        kind: "join_spree" as const,
        severity: "low" as const,
        reason: `Customer ${j.name} joined ${j.businesses} businesses in 24h`,
        businessId: null,
        businessName: null,
        details: j,
      })),
    ];
    return c.json({ items });
  })

  .get("/plans", async (c) => {
    const plans = await c.get("db").select().from(subscriptionPlans).orderBy(asc(subscriptionPlans.sortOrder)).all();
    return c.json({ plans });
  })

  .put("/plans/:id", validate("json", planUpdateSchema), async (c) => {
    const input = c.req.valid("json");
    if (Object.keys(input).length === 0) throw badRequest("Nothing to update");
    const db = c.get("db");
    const plan = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, c.req.param("id"))).get();
    if (!plan) throw notFound("Plan");
    if (plan.code === "free") {
      if (input.isActive === false) throw badRequest("The Free plan must stay active: it is the fallback for every account");
      if (input.pricePaise !== undefined && input.pricePaise !== 0) throw badRequest("The Free plan must cost ₹0");
    }
    await db.batch([
      db.update(subscriptionPlans).set(input).where(eq(subscriptionPlans.id, plan.id)),
      auditInsert(c, { action: "admin.plan_updated", entityType: "subscription_plan", entityId: plan.id, metadata: input }),
    ]);
    return c.json({ plan: await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, plan.id)).get() });
  })

  .get("/settings", async (c) => {
    const stored = await c.get("db").select().from(platformSettings).all();
    const values = Object.fromEntries(stored.map((s) => [s.key, s.value]));
    return c.json({ settings: { ...SETTINGS_DEFAULTS, ...values } });
  })

  .put("/settings", validate("json", settingsSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.get("db");
    const user = c.get("user")!;
    const entries = Object.entries(input).filter(([, v]) => v !== undefined);
    if (!entries.length) throw badRequest("Nothing to update");
    await db.batch([
      ...entries.map(([key, value]) =>
        db
          .insert(platformSettings)
          .values({ key, value: value ?? null, updatedByUserId: user.id })
          .onConflictDoUpdate({ target: platformSettings.key, set: { value: value ?? null, updatedByUserId: user.id, updatedAt: new Date() } }),
      ),
      auditInsert(c, { action: "admin.settings_updated", entityType: "platform_settings", metadata: input }),
    ] as unknown as Parameters<typeof db.batch>[0]);
    const stored = await db.select().from(platformSettings).all();
    return c.json({ settings: { ...SETTINGS_DEFAULTS, ...Object.fromEntries(stored.map((s) => [s.key, s.value])) } });
  })

  .get("/health", async (c) => {
    const D1 = c.env.DB;
    const t0 = Date.now();
    await D1.prepare("SELECT 1").first();
    const dbLatencyMs = Date.now() - t0;
    const tables = ["users", "businesses", "customers", "customer_cards", "stamp_transactions", "notification_logs", "ai_usage_logs", "audit_logs"];
    const counts = await D1.batch(tables.map((t) => D1.prepare(`SELECT count(*) AS n FROM ${t}`)));
    const [outbox, failed] = await Promise.all([
      one<{ queued: number | null; sending: number | null; oldest: number | null }>(
        D1.prepare(
          `SELECT sum(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued, sum(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) AS sending,
           min(CASE WHEN status = 'queued' THEN created_at END) AS oldest FROM notification_logs WHERE status IN ('queued','sending')`,
        ),
      ),
      one<{ n: number }>(D1.prepare("SELECT count(*) AS n FROM notification_logs WHERE status = 'failed' AND updated_at >= ?1").bind(Date.now() - DAY_MS)),
    ]);
    const env = c.env;
    return c.json({
      database: {
        ok: true,
        latencyMs: dbLatencyMs,
        rowCounts: Object.fromEntries(tables.map((t, i) => [t, (counts[i]!.results[0] as { n: number }).n])),
      },
      integrations: {
        reviewAi: env.AI_PROVIDER === "gemini" ? Boolean(env.GEMINI_API_KEY) : Boolean(env.AI),
        aiGateway: Boolean(env.AI_GATEWAY_ID),
        whatsapp: Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
        whatsappWebhook: Boolean(env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN),
        razorpay: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
        razorpayWebhook: Boolean(env.RAZORPAY_WEBHOOK_SECRET),
        twilioOtp: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID),
        turnstile: Boolean(env.TURNSTILE_SECRET_KEY),
        email: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
      },
      outbox: {
        queued: outbox?.queued ?? 0,
        sending: outbox?.sending ?? 0,
        oldestQueuedAgeSeconds: outbox?.oldest ? Math.round((Date.now() - outbox.oldest) / 1000) : null,
        failedLast24h: failed?.n ?? 0,
      },
      environment: env.APP_ENV,
    });
  });

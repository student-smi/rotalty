import { describe, expect, it } from "vitest";
import { env, loyaltySetup, signUp, TestClient, uniqueEmail } from "./helpers";

async function superAdmin() {
  const admin = await signUp("Admin");
  await env.DB.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").bind(admin.userId).run();
  return admin;
}

async function planId(code: string) {
  return (await env.DB.prepare("SELECT id FROM subscription_plans WHERE code = ?").bind(code).first<{ id: string }>())!.id;
}

describe("super admin platform endpoints", () => {
  it("forbids regular users", async () => {
    const user = await signUp();
    for (const path of ["/subscriptions", "/revenue", "/ai-usage", "/transactions", "/suspicious", "/plans", "/settings", "/health"]) {
      expect((await user.client.get(`/api/admin${path}`)).status, path).toBe(403);
    }
    expect((await user.client.request("PUT", `/api/admin/subscriptions/${user.userId}`, { planCode: "agency", days: 30 })).status).toBe(403);
    expect((await new TestClient().get("/api/admin/health")).status).toBe(401);
  });

  it("validates plan edits and protects the Free plan", async () => {
    const admin = await superAdmin();
    const freeId = await planId("free");
    const starterId = await planId("starter");

    expect((await admin.client.request("PUT", `/api/admin/plans/${freeId}`, { isActive: false })).status).toBe(400);
    expect((await admin.client.request("PUT", `/api/admin/plans/${freeId}`, { pricePaise: 100 })).status).toBe(400);
    expect((await admin.client.request("PUT", `/api/admin/plans/${starterId}`, { limits: { businesses: 1 } })).status).toBe(400);

    const original = (await admin.client.get("/api/admin/plans")).json.plans.find((p: { id: string }) => p.id === starterId);
    const res = await admin.client.request("PUT", `/api/admin/plans/${starterId}`, {
      pricePaise: 59900,
      limits: { ...original.limits, staffPerBusiness: 7 },
    });
    expect(res.status).toBe(200);
    expect(res.json.plan).toMatchObject({ pricePaise: 59900 });
    expect(res.json.plan.limits.staffPerBusiness).toBe(7);

    await admin.client.request("PUT", `/api/admin/plans/${starterId}`, { pricePaise: original.pricePaise, limits: original.limits });
  });

  it("grants a subscription manually", async () => {
    const admin = await superAdmin();
    const user = await signUp();
    const res = await admin.client.request("PUT", `/api/admin/subscriptions/${user.userId}`, { planCode: "agency", days: 10 });
    expect(res.status).toBe(200);
    const sub = (await user.client.get("/api/billing/subscription")).json;
    expect(sub.plan.code).toBe("agency");

    const list = await admin.client.get(`/api/admin/subscriptions?q=${encodeURIComponent(user.email)}`);
    expect(list.json.subscriptions).toHaveLength(1);
    expect(list.json.subscriptions[0]).toMatchObject({ planCode: "agency", status: "active" });

    const audit = await env.DB.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = 'admin.subscription_granted' AND entity_id = ?")
      .bind(user.userId)
      .first<{ n: number }>();
    expect(audit!.n).toBe(1);
  });

  it("flags staff issuing more than 30 points in an hour and cards with repeated failures", async () => {
    const admin = await superAdmin();
    const { owner, program, cardId } = await loyaltySetup();
    const bid = owner.business.id;
    const now = Date.now();
    const customerId = (await env.DB.prepare("SELECT customer_id FROM customer_cards WHERE id = ?").bind(cardId).first<{ customer_id: string }>())!.customer_id;
    const stmts = [];
    for (let i = 0; i < 31; i++) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO stamp_transactions (id, business_id, program_id, card_id, customer_id, type, points, channel, actor_user_id, idempotency_key, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'earn', 1, 'manual', ?6, ?7, ?8)`,
        ).bind(crypto.randomUUID(), bid, program.id, cardId, customerId, owner.userId, `sim:${crypto.randomUUID()}`, now),
      );
    }
    for (let i = 0; i < 5; i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO interaction_events (id, business_id, type, reason, card_id, created_at) VALUES (?1, ?2, 'issue_failed', 'DAILY_LIMIT', ?3, ?4)",
        ).bind(crypto.randomUUID(), bid, cardId, now),
      );
    }
    await env.DB.batch(stmts);

    const res = await admin.client.get("/api/admin/suspicious");
    expect(res.status).toBe(200);
    const mine = res.json.items.filter((i: { businessId: string | null }) => i.businessId === bid);
    const burst = mine.find((i: { kind: string }) => i.kind === "staff_burst");
    expect(burst.details.points).toBe(31);
    expect(burst.reason).toContain(owner.email);
    expect(mine.find((i: { kind: string }) => i.kind === "card_failures").details.failures).toBe(5);

    const tx = await admin.client.get(`/api/admin/transactions?businessId=${bid}`);
    expect(tx.json.transactions).toHaveLength(31);
    expect(tx.json.transactions[0]).toMatchObject({ businessId: bid, type: "earn" });
  });

  it("reports overview, revenue, AI usage and health without leaking secrets", async () => {
    const admin = await superAdmin();
    const user = await signUp();
    const starter = await planId("starter");
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO payment_transactions (id, user_id, plan_id, provider, order_id, payment_id, amount_paise, currency, status, paid_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'razorpay', ?4, ?5, 49900, 'INR', 'paid', ?6, ?6, ?6)`,
      ).bind(crypto.randomUUID(), user.userId, starter, `order_${crypto.randomUUID()}`, `pay_${crypto.randomUUID()}`, now),
      env.DB.prepare(
        `INSERT INTO ai_usage_logs (id, provider, model, feature, input_tokens, output_tokens, cost_micro_usd, status, created_at)
         VALUES (?1, 'gemini', 'test', 'review_drafts', 100, 50, 1234, 'success', ?2)`,
      ).bind(crypto.randomUUID(), now),
    ]);

    const overview = (await admin.client.get("/api/admin/overview")).json;
    expect(overview.revenueThisMonthPaise).toBeGreaterThanOrEqual(49900);
    expect(overview.aiCostThisMonthMicroUsd).toBeGreaterThanOrEqual(1234);
    expect(typeof overview.customers).toBe("number");
    expect(typeof overview.transactionsToday).toBe("number");

    const revenue = (await admin.client.get("/api/admin/revenue")).json;
    expect(revenue.months).toHaveLength(12);
    expect(revenue.months.at(-1).amountPaise).toBeGreaterThanOrEqual(49900);

    const ai = (await admin.client.get("/api/admin/ai-usage?days=7")).json;
    expect(ai.totals.calls).toBeGreaterThanOrEqual(1);

    const health = await admin.client.get("/api/admin/health");
    expect(health.status).toBe(200);
    expect(health.json.database.ok).toBe(true);
    for (const v of Object.values(health.json.integrations)) expect(typeof v).toBe("boolean");
    expect(JSON.stringify(health.json)).not.toContain(env.BETTER_AUTH_SECRET);
  });

  it("stores platform settings and exposes the maintenance message to signed-in users", async () => {
    const admin = await superAdmin();
    const user = await signUp();
    expect((await admin.client.get("/api/admin/settings")).json.settings).toMatchObject({ signupsEnabled: true });
    const res = await admin.client.request("PUT", "/api/admin/settings", { maintenanceMessage: "Planned upgrade tonight", signupsEnabled: false });
    expect(res.status).toBe(200);
    expect(res.json.settings).toMatchObject({ maintenanceMessage: "Planned upgrade tonight", signupsEnabled: false });

    expect((await user.client.get("/api/billing/platform-status")).json.maintenanceMessage).toBe("Planned upgrade tonight");
    const blocked = await new TestClient().post("/api/auth/sign-up/email", { name: "Late", email: uniqueEmail(), password: "correct-horse-battery" });
    expect(blocked.status).toBe(403);
    await admin.client.request("PUT", "/api/admin/settings", { maintenanceMessage: null, signupsEnabled: true });
  });
});

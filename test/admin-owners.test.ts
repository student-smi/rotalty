import { describe, expect, it } from "vitest";
import { env, ownerWithBusiness, signUp } from "./helpers";

const DAY = 86_400_000;

async function admin() {
  const a = await signUp("Admin");
  await env.DB.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").bind(a.userId).run();
  return a;
}

async function setSub(userId: string, plan: string, end: number, status = "active") {
  await env.DB.prepare(
    "INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0) ON CONFLICT(user_id) DO UPDATE SET plan_id = excluded.plan_id, status = excluded.status, current_period_end = excluded.current_period_end",
  )
    .bind(crypto.randomUUID(), userId, plan, status, end)
    .run();
}

describe("Super Admin: shop owners", () => {
  it("lists owners with plan status, days left, shops and phone", async () => {
    const a = await admin();
    const expiring = await ownerWithBusiness("free");
    await expiring.client.patch(`/api/businesses/${expiring.business.id}`, { phone: "98765 43210" });
    await setSub(expiring.userId, "plan_starter", Date.now() + 3 * DAY);
    const expired = await ownerWithBusiness("free");
    await setSub(expired.userId, "plan_starter", Date.now() - DAY);

    const res = await a.client.get("/api/admin/owners");
    expect(res.status).toBe(200);
    const find = (id: string) => res.json.owners.find((o: { userId: string }) => o.userId === id);
    expect(find(expiring.userId)).toMatchObject({ status: "expiring", daysLeft: 3, planName: "Starter", phone: "9876543210", shops: 1 });
    expect(find(expired.userId)).toMatchObject({ status: "expired", planName: "Starter" });
    expect(find(a.userId)).toBeUndefined(); // no shop → not an owner

    const details = await a.client.get(`/api/admin/owners/${expiring.userId}`);
    expect(details.json.shops[0]).toMatchObject({ name: expiring.business.name });
    expect(details.json.subscription).toMatchObject({ planName: "Starter" });
  });

  it("renews by adding to the current period, or starting today, and records money received", async () => {
    const a = await admin();
    const o = await ownerWithBusiness("free");
    const end = Date.now() + 10 * DAY;
    await setSub(o.userId, "plan_starter", end);

    const extend = await a.client.request("PUT", `/api/admin/subscriptions/${o.userId}`, { planCode: "starter", days: 30, mode: "extend", receivedPaise: 49900, receivedNote: "UPI 412345678901" });
    expect(extend.status).toBe(200);
    expect(extend.json.extended).toBe(true);
    expect(Math.round((new Date(extend.json.currentPeriodEnd).getTime() - end) / DAY)).toBe(30);

    const pay = await env.DB.prepare("SELECT provider, status, amount_paise FROM payment_transactions WHERE user_id = ?").bind(o.userId).first();
    expect(pay).toEqual({ provider: "manual", status: "paid", amount_paise: 49900 });

    const replace = await a.client.request("PUT", `/api/admin/subscriptions/${o.userId}`, { planCode: "professional", days: 30, mode: "extend" });
    expect(replace.json.extended).toBe(false); // different plan → starts today
    expect(Math.round((new Date(replace.json.currentPeriodEnd).getTime() - Date.now()) / DAY)).toBe(30);
  });

  it("is only for Super Admins", async () => {
    const o = await ownerWithBusiness();
    expect((await o.client.get("/api/admin/owners")).status).toBe(403);
    expect((await o.client.request("PUT", `/api/admin/subscriptions/${o.userId}`, { planCode: "agency", days: 30 })).status).toBe(403);
  });
});

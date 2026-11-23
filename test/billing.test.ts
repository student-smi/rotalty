import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBusiness, env, ownerWithBusiness, setPlan, signUp, TestClient } from "./helpers";
import { createDb } from "../src/worker/db/client";
import { expireSubscriptions } from "../src/worker/services/billing-cron";

const KEY_ID = "rzp_test_key";
const KEY_SECRET = "rzp_test_secret";
const WEBHOOK_SECRET = "rzp_webhook_secret";
const mutableEnv = env as unknown as Record<string, string | undefined>;

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function configureRazorpay() {
  mutableEnv.RAZORPAY_KEY_ID = KEY_ID;
  mutableEnv.RAZORPAY_KEY_SECRET = KEY_SECRET;
  mutableEnv.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
}

function unconfigureRazorpay() {
  delete mutableEnv.RAZORPAY_KEY_ID;
  delete mutableEnv.RAZORPAY_KEY_SECRET;
  delete mutableEnv.RAZORPAY_WEBHOOK_SECRET;
}

let orderCounter = 0;
function mockRazorpay() {
  const realFetch = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.razorpay.com/v1/orders") {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: `order_${++orderCounter}_${crypto.randomUUID().slice(0, 6)}`, amount: body.amount, currency: "INR", receipt: body.receipt, status: "created" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  });
}

async function checkout(client: TestClient, planCode = "starter") {
  const res = await client.post("/api/billing/checkout", { planCode });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json as { orderId: string; amountPaise: number; keyId: string };
}

async function pay(client: TestClient, orderId: string, paymentId = `pay_${crypto.randomUUID().slice(0, 10)}`) {
  const signature = await hmacHex(KEY_SECRET, `${orderId}|${paymentId}`);
  return { res: await client.post("/api/billing/verify", { orderId, paymentId, signature }), paymentId };
}

async function subscription(client: TestClient) {
  return (await client.get("/api/billing/subscription")).json;
}

async function webhook(body: unknown, secret = WEBHOOK_SECRET) {
  const raw = JSON.stringify(body);
  const client = new TestClient();
  return client.request("POST", "/api/webhooks/razorpay", undefined, {
    body: raw,
    headers: { "content-type": "application/json", "x-razorpay-signature": await hmacHex(secret, raw) },
  });
}

describe("billing without credentials", () => {
  beforeEach(unconfigureRazorpay);

  it("lists plans and reports payments unavailable", async () => {
    const { client } = await signUp();
    const res = await client.get("/api/billing/plans");
    expect(res.status).toBe(200);
    expect(res.json.paymentsAvailable).toBe(false);
    expect(res.json.plans.map((p: { code: string }) => p.code)).toEqual(["free", "starter", "professional", "agency"]);
  });

  it("returns 503 from checkout when Razorpay is not configured", async () => {
    const { client } = await signUp();
    const res = await client.post("/api/billing/checkout", { planCode: "starter" });
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("PAYMENTS_UNAVAILABLE");
  });

  it("rejects webhooks when no secret is configured", async () => {
    const res = await webhook({ event: "payment.captured" });
    expect(res.status).toBe(401);
  });

  it("requires sign-in", async () => {
    expect((await new TestClient().get("/api/billing/subscription")).status).toBe(401);
  });
});

describe("billing with Razorpay", () => {
  let spy: ReturnType<typeof mockRazorpay>;
  beforeEach(() => {
    configureRazorpay();
    spy = mockRazorpay();
  });
  afterEach(() => {
    spy.mockRestore();
    unconfigureRazorpay();
  });

  it("creates an order and a pending payment row", async () => {
    const { client, userId } = await signUp();
    const order = await checkout(client);
    expect(order.amountPaise).toBe(49900);
    expect(order.keyId).toBe(KEY_ID);
    const row = await env.DB.prepare("SELECT status, amount_paise FROM payment_transactions WHERE order_id = ? AND user_id = ?")
      .bind(order.orderId, userId)
      .first<{ status: string; amount_paise: number }>();
    expect(row).toEqual({ status: "created", amount_paise: 49900 });
  });

  it("refuses checkout for the free plan", async () => {
    const { client } = await signUp();
    expect((await client.post("/api/billing/checkout", { planCode: "free" })).status).toBe(400);
  });

  it("rejects a bad signature and activates on a good one", async () => {
    const { client } = await signUp();
    const order = await checkout(client);
    const bad = await client.post("/api/billing/verify", { orderId: order.orderId, paymentId: "pay_x", signature: "deadbeef" });
    expect(bad.status).toBe(400);
    expect((await subscription(client)).plan.code).toBe("free");

    const { res } = await pay(client, order.orderId);
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("activated");
    const sub = await subscription(client);
    expect(sub.plan.code).toBe("starter");
    expect(sub.subscription.status).toBe("active");
  });

  it("is idempotent when the same payment is verified twice", async () => {
    const { client } = await signUp();
    const order = await checkout(client);
    const paymentId = "pay_idem_1" + crypto.randomUUID().slice(0, 4);
    const first = await pay(client, order.orderId, paymentId);
    const end1 = (await subscription(client)).subscription.currentPeriodEnd;
    const second = await pay(client, order.orderId, paymentId);
    expect(first.res.json.status).toBe("activated");
    expect(second.res.json.status).toBe("already_processed");
    expect((await subscription(client)).subscription.currentPeriodEnd).toBe(end1);
  });

  it("does not let a user verify another user's order", async () => {
    const a = await signUp();
    const b = await signUp();
    const order = await checkout(a.client);
    const { res } = await pay(b.client, order.orderId);
    expect(res.status).toBe(404);
  });

  it("extends the period when renewing the same plan", async () => {
    const { client } = await signUp();
    await pay(client, (await checkout(client)).orderId);
    const end1 = new Date((await subscription(client)).subscription.currentPeriodEnd).getTime();
    await pay(client, (await checkout(client)).orderId);
    const end2 = new Date((await subscription(client)).subscription.currentPeriodEnd).getTime();
    expect(end2 - end1).toBe(30 * 86_400_000);
  });

  it("activates through a signed webhook and ignores invalid signatures", async () => {
    const { client } = await signUp();
    const order = await checkout(client);
    const payload = {
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_wh_" + crypto.randomUUID().slice(0, 6), order_id: order.orderId } } },
    };
    const forged = await webhook(payload, "wrong-secret");
    expect(forged.status).toBe(401);
    expect((await subscription(client)).plan.code).toBe("free");

    const ok = await webhook(payload);
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe("activated");
    expect((await subscription(client)).plan.code).toBe("starter");

    const replay = await webhook(payload);
    expect(replay.json.status).toBe("already_processed");
  });

  it("marks failed payments from the webhook", async () => {
    const { client } = await signUp();
    const order = await checkout(client);
    const res = await webhook({
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_f", order_id: order.orderId, error_description: "Card declined" } } },
    });
    expect(res.status).toBe(200);
    const payments = (await client.get("/api/billing/payments")).json.payments;
    expect(payments[0]).toMatchObject({ status: "failed", failureReason: "Card declined" });
  });

  it("raises plan limits after upgrading", async () => {
    const { client } = await signUp();
    await createBusiness(client);
    expect((await client.post("/api/businesses", { name: "Second shop", category: "retail" })).status).toBe(403);
    await pay(client, (await checkout(client, "professional")).orderId);
    expect((await client.post("/api/businesses", { name: "Second shop", category: "retail" })).status).toBe(201);
  });
});

describe("subscription expiry", () => {
  it("downgrades to Free after the period ends and enforces Free limits", async () => {
    const owner = await ownerWithBusiness("professional");
    expect((await owner.client.post("/api/businesses", { name: "Branch two", category: "cafe" })).status).toBe(201);

    await env.DB.prepare("UPDATE subscriptions SET current_period_end = ? WHERE user_id = ?").bind(Date.now() - 1000, owner.userId).run();
    await expireSubscriptions(createDb(env.DB));
    const row = await env.DB.prepare("SELECT status FROM subscriptions WHERE user_id = ?").bind(owner.userId).first<{ status: string }>();
    expect(row!.status).toBe("expired");

    const sub = await subscription(owner.client);
    expect(sub.plan.code).toBe("free");
    expect(sub.subscription.status).toBe("expired");
    // Existing businesses remain, but adding another is blocked on Free.
    expect(sub.account.businesses.used).toBe(2);
    const blocked = await owner.client.post("/api/businesses", { name: "Branch three", category: "cafe" });
    expect(blocked.status).toBe(403);
    expect(blocked.json.error.code).toBe("PLAN_LIMIT_REACHED");
  });

  it("reports usage against limits per business", async () => {
    const owner = await ownerWithBusiness("starter");
    const sub = await subscription(owner.client);
    expect(sub.plan.code).toBe("starter");
    const biz = sub.businesses.find((b: { businessId: string }) => b.businessId === owner.business.id);
    expect(biz.usage.locationsPerBusiness).toEqual({ used: 1, limit: 2 });
    expect(biz.usage.staffPerBusiness).toEqual({ used: 1, limit: 5 });
  });

  it("does not expire subscriptions that are still within their period", async () => {
    const owner = await signUp();
    await setPlan(owner.userId, "starter");
    await expireSubscriptions(createDb(env.DB));
    expect((await subscription(owner.client)).plan.code).toBe("starter");
  });
});

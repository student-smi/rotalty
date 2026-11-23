import { describe, expect, it } from "vitest";
import { createProgram, env, joinAsCustomer, loyaltySetup, ownerWithBusiness, TestClient, uniquePhone } from "./helpers";
import { sha256Hex } from "../src/worker/lib/crypto";

async function plantOtp(phone: string, code: string) {
  await env.DB.prepare("INSERT INTO otp_codes (id, phone, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)")
    .bind(crypto.randomUUID(), phone, await sha256Hex(`${phone}:${code}`), Date.now() + 600_000, Date.now())
    .run();
}

describe("public pricing", () => {
  it("lists active plans without login", async () => {
    const res = await new TestClient().get("/api/public/plans");
    expect(res.status).toBe(200);
    expect(res.json.plans.map((p: { code: string }) => p.code)).toEqual(["free", "starter", "professional", "agency"]);
    expect(res.json.plans[0]).toMatchObject({ pricePaise: 0, limits: { businesses: 1 } });
  });
});

describe("customer join", () => {
  it("creates a customer, card and session without any app or password", async () => {
    const { owner, customer, cardId } = await loyaltySetup();
    const cards = await customer.get("/api/c/cards");
    expect(cards.status).toBe(200);
    expect(cards.json.cards).toHaveLength(1);
    expect(cards.json.cards[0]).toMatchObject({ id: cardId, pointsBalance: 0, business: { slug: owner.business.slug } });

    const page = await customer.get(`/api/public/b/${owner.business.slug}`);
    expect(page.json.myCards.map((c: { id: string }) => c.id)).toEqual([cardId]);
  });

  it("supports multiple loyalty cards across businesses under one customer", async () => {
    const first = await loyaltySetup();
    const other = await ownerWithBusiness();
    const otherProgram = await createProgram(other.client, other.business.id);
    const res = await first.customer.post("/api/c/join", {
      slug: other.business.slug,
      programId: otherProgram.id,
      name: "Riya Shah",
      phone: first.phone,
    });
    expect(res.status).toBe(201);
    expect((await first.customer.get("/api/c/cards")).json.cards).toHaveLength(2);
  });

  it("never hands an existing number's cards to a new device", async () => {
    const { owner, program, phone } = await loyaltySetup();
    const res = await new TestClient().post("/api/c/join", { slug: owner.business.slug, programId: program.id, name: "Imposter", phone });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("PHONE_REGISTERED");
  });

  it("records WhatsApp consent only when the customer opts in", async () => {
    const { owner, program } = await loyaltySetup();
    const optIn = await joinAsCustomer(owner.business.slug, program.id, { whatsappConsent: true });
    const optOut = await joinAsCustomer(owner.business.slug, program.id);
    const q = "SELECT c.status FROM customer_consents c JOIN customers u ON u.id = c.customer_id WHERE u.phone = ?";
    expect(await env.DB.prepare(q).bind(optIn.phone).first()).toEqual({ status: "granted" });
    expect(await env.DB.prepare(q).bind(optOut.phone).first()).toBeNull();
  });

  it("can't join paused programs", async () => {
    const { client, business } = await ownerWithBusiness();
    const program = await createProgram(client, business.id);
    await client.patch(`/api/businesses/${business.id}/programs/${program.id}`, { status: "paused" });
    const res = await new TestClient().post("/api/c/join", { slug: business.slug, programId: program.id, name: "A B", phone: uniquePhone() });
    expect(res.status).toBe(404);
  });

  it("enforces the plan's customer limit", async () => {
    const { client, business, userId } = await ownerWithBusiness("free");
    const planId = `tiny-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO subscription_plans (id, code, name, price_paise, interval_days, limits, is_active, sort_order, created_at, updated_at) VALUES (?1, ?1, 'Tiny', 0, 30, ?2, 1, 9, 0, 0)",
    )
      .bind(planId, JSON.stringify({ businesses: 1, locationsPerBusiness: 1, staffPerBusiness: 1, customersPerBusiness: 1, programsPerBusiness: 1, aiGenerationsPerMonth: 0, campaignMessagesPerMonth: 0, nfc: false, marketing: false, advancedAnalytics: false }))
      .run();
    await env.DB.prepare("INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, 0, 0)")
      .bind(crypto.randomUUID(), userId, planId, Date.now() + 86400_000)
      .run();
    const program = await createProgram(client, business.id);
    await joinAsCustomer(business.slug, program.id);
    const res = await new TestClient().post("/api/c/join", { slug: business.slug, programId: program.id, name: "Second", phone: uniquePhone() });
    expect(res.json.error.code).toBe("PLAN_LIMIT_REACHED");
  });
});

describe("customer recovery with OTP", () => {
  it("restores access to existing cards after verifying the phone", async () => {
    const { cardId, phone } = await loyaltySetup();
    const device = new TestClient();
    await plantOtp(phone, "482913");
    expect((await device.post("/api/c/otp/verify", { phone, code: "000000" })).status).toBe(400);
    const ok = await device.post("/api/c/otp/verify", { phone, code: "482913" });
    expect(ok.status).toBe(200);
    const cards = await device.get("/api/c/cards");
    expect(cards.json.cards.map((c: { id: string }) => c.id)).toEqual([cardId]);
    expect((await device.get("/api/c/session")).json.customer.phoneVerified).toBe(true);
  });

  it("doesn't reveal whether a number is registered and doesn't send to unknown numbers", async () => {
    const unknown = uniquePhone();
    const res = await new TestClient().post("/api/c/otp/send", { phone: unknown });
    expect(res.json).toEqual({ sent: true });
    expect(await env.DB.prepare("SELECT id FROM otp_codes WHERE phone = ?").bind(unknown).first()).toBeNull();
  });

  it("rate limits code requests and wrong attempts", async () => {
    const { phone } = await loyaltySetup();
    const client = new TestClient();
    for (let i = 0; i < 3; i++) expect((await client.post("/api/c/otp/send", { phone })).status).toBe(200);
    expect((await client.post("/api/c/otp/send", { phone })).status).toBe(429);

    for (let i = 0; i < 5; i++) await client.post("/api/c/otp/verify", { phone, code: "111111" });
    expect((await client.post("/api/c/otp/verify", { phone, code: "111111" })).status).toBe(429);
  });
});

describe("customer privacy", () => {
  it("can't read another customer's card", async () => {
    const { owner, program, cardId } = await loyaltySetup();
    const other = await joinAsCustomer(owner.business.slug, program.id);
    expect((await other.customer.get(`/api/c/cards/${cardId}`)).status).toBe(404);
  });

  it("manages consent only for businesses they have a card with", async () => {
    const { owner, customer } = await loyaltySetup();
    const elsewhere = await ownerWithBusiness();
    const put = await customer.request("PUT", "/api/c/consents", { businessId: owner.business.id, channel: "whatsapp", granted: true });
    expect(put.status).toBe(200);
    const list = await customer.get("/api/c/consents");
    expect(list.json.businesses[0].channels.whatsapp).toBe(true);
    const foreign = await customer.request("PUT", "/api/c/consents", { businessId: elsewhere.business.id, channel: "whatsapp", granted: true });
    expect(foreign.status).toBe(404);
  });

  it("deletes personal data on request and frees the number", async () => {
    const { owner, program, customer, cardId, phone } = await loyaltySetup();
    await customer.request("PUT", "/api/c/consents", { businessId: owner.business.id, channel: "whatsapp", granted: true });
    expect((await customer.delete("/api/c/me")).status).toBe(200);
    expect((await customer.get("/api/c/cards")).status).toBe(401);

    const row = await env.DB.prepare(
      "SELECT u.name, u.phone, u.deleted_at IS NOT NULL AS deleted, c.status FROM customer_cards k JOIN customers u ON u.id = k.customer_id LEFT JOIN customer_consents c ON c.customer_id = u.id WHERE k.id = ?",
    )
      .bind(cardId)
      .first();
    expect(row).toEqual({ name: "Deleted customer", phone: null, deleted: 1, status: "withdrawn" });

    const rejoin = await new TestClient().post("/api/c/join", { slug: owner.business.slug, programId: program.id, name: "Riya", phone });
    expect(rejoin.status).toBe(201);
  });
});

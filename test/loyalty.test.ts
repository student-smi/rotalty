import { describe, expect, it } from "vitest";
import {
  createProgram,
  env,
  inviteAndAccept,
  issueManual,
  joinAsCustomer,
  loyaltySetup,
  ownerWithBusiness,
} from "./helpers";

const base = (bid: string) => `/api/businesses/${bid}`;

describe("loyalty programs", () => {
  it("validates program input", async () => {
    const { client, business } = await ownerWithBusiness();
    const tooMany = await client.post(`${base(business.id)}/programs`, {
      name: "Card",
      stampsRequired: 5,
      rewards: [{ name: "Big reward", pointsRequired: 6 }],
    });
    expect(tooMany.status).toBe(400);
    const badDates = await client.post(`${base(business.id)}/programs`, {
      name: "Card",
      stampsRequired: 5,
      startsAt: "2026-12-10",
      endsAt: "2026-12-01",
      rewards: [{ name: "Reward", pointsRequired: 5 }],
    });
    expect(badDates.status).toBe(400);
  });

  it("enforces the plan's program limit", async () => {
    const { client, business } = await ownerWithBusiness("free");
    await createProgram(client, business.id);
    const second = await client.post(`${base(business.id)}/programs`, {
      name: "Second",
      stampsRequired: 5,
      rewards: [{ name: "Reward", pointsRequired: 5 }],
    });
    expect(second.status).toBe(403);
    expect(second.json.error.code).toBe("PLAN_LIMIT_REACHED");
  });

  it("requires loyalty.manage to create programs", async () => {
    const owner = await ownerWithBusiness();
    const staff = await inviteAndAccept(owner.client, owner.business.id, "staff");
    const res = await staff.client.post(`${base(owner.business.id)}/programs`, {
      name: "X",
      stampsRequired: 5,
      rewards: [{ name: "Reward", pointsRequired: 5 }],
    });
    expect(res.status).toBe(403);
  });
});

describe("loyalty engine: issuing points", () => {
  it("issues a point and records it in the ledger", async () => {
    const { owner, cardId } = await loyaltySetup();
    const res = await issueManual(owner.client, owner.business.id, cardId);
    expect(res.status).toBe(200);
    expect(res.json.result.pointsBalance).toBe(1);
    const ledger = await env.DB.prepare("SELECT type, points, channel FROM stamp_transactions WHERE card_id = ?").bind(cardId).all();
    expect(ledger.results).toEqual([{ type: "earn", points: 1, channel: "manual" }]);
  });

  it("enforces the daily limit per customer", async () => {
    const { owner, cardId } = await loyaltySetup();
    expect((await issueManual(owner.client, owner.business.id, cardId)).status).toBe(200);
    const second = await issueManual(owner.client, owner.business.id, cardId);
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe("DAILY_LIMIT");
  });

  it("never double-issues for the same idempotency key", async () => {
    const { owner, cardId } = await loyaltySetup({ dailyLimitPerCustomer: 5 });
    const body = { idempotencyKey: "same-key-123456" };
    const url = `${base(owner.business.id)}/cards/${cardId}/points`;
    expect((await owner.client.post(url, body)).status).toBe(200);
    const again = await owner.client.post(url, body);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("DUPLICATE");
    const card = await env.DB.prepare("SELECT points_balance FROM customer_cards WHERE id = ?").bind(cardId).first<{ points_balance: number }>();
    expect(card!.points_balance).toBe(1);
  });

  it("enforces the daily limit even under concurrent requests", async () => {
    const { owner, cardId } = await loyaltySetup();
    const results = await Promise.all(Array.from({ length: 5 }, () => issueManual(owner.client, owner.business.id, cardId)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const card = await env.DB.prepare("SELECT points_balance FROM customer_cards WHERE id = ?").bind(cardId).first<{ points_balance: number }>();
    expect(card!.points_balance).toBe(1);
  });

  it("applies the cooldown between points", async () => {
    const { owner, cardId } = await loyaltySetup({ dailyLimitPerCustomer: 5, cooldownMinutes: 30 });
    expect((await issueManual(owner.client, owner.business.id, cardId)).status).toBe(200);
    const res = await issueManual(owner.client, owner.business.id, cardId);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("COOLDOWN");
  });

  it("refuses points for paused or ended programs and blocked cards", async () => {
    const { owner, program, cardId } = await loyaltySetup({ dailyLimitPerCustomer: 5 });
    await owner.client.patch(`${base(owner.business.id)}/programs/${program.id}`, { status: "paused" });
    expect((await issueManual(owner.client, owner.business.id, cardId)).json.error.code).toBe("PROGRAM_INACTIVE");

    await owner.client.patch(`${base(owner.business.id)}/programs/${program.id}`, { status: "active", endsAt: new Date(Date.now() - 1000).toISOString() });
    expect((await issueManual(owner.client, owner.business.id, cardId)).json.error.code).toBe("PROGRAM_INACTIVE");

    await owner.client.patch(`${base(owner.business.id)}/programs/${program.id}`, { endsAt: null });
    await env.DB.prepare("UPDATE customer_cards SET status = 'blocked' WHERE id = ?").bind(cardId).run();
    expect((await issueManual(owner.client, owner.business.id, cardId)).json.error.code).toBe("CARD_BLOCKED");
  });

  it("reports unlocked rewards and records analytics events", async () => {
    const { owner, cardId } = await loyaltySetup({
      stampsRequired: 3,
      dailyLimitPerCustomer: 10,
      rewards: [{ name: "Free juice", pointsRequired: 3 }],
    });
    await issueManual(owner.client, owner.business.id, cardId);
    await issueManual(owner.client, owner.business.id, cardId);
    const third = await issueManual(owner.client, owner.business.id, cardId);
    expect(third.json.result.unlockedRewards.map((r: { name: string }) => r.name)).toEqual(["Free juice"]);

    const events = await env.DB.prepare("SELECT type, COUNT(*) AS n FROM interaction_events WHERE card_id = ? GROUP BY type ORDER BY type")
      .bind(cardId)
      .all();
    expect(events.results).toEqual(
      expect.arrayContaining([
        { type: "issue_success", n: 3 },
        { type: "reward_unlocked", n: 1 },
      ]),
    );
  });

  it("records failed attempts for analytics", async () => {
    const { owner, cardId } = await loyaltySetup();
    await issueManual(owner.client, owner.business.id, cardId);
    await issueManual(owner.client, owner.business.id, cardId);
    const row = await env.DB.prepare("SELECT reason FROM interaction_events WHERE card_id = ? AND type = 'issue_failed'").bind(cardId).first();
    expect(row).toEqual({ reason: "DAILY_LIMIT" });
  });
});

describe("loyalty engine: redeeming rewards", () => {
  async function cardWithPoints(points: number) {
    const setup = await loyaltySetup({ stampsRequired: 3, dailyLimitPerCustomer: 10, rewards: [{ name: "Free coffee", pointsRequired: 3 }] });
    for (let i = 0; i < points; i++) await issueManual(setup.owner.client, setup.owner.business.id, setup.cardId);
    return setup;
  }

  it("rejects redemption without enough points", async () => {
    const { owner, program, cardId } = await cardWithPoints(2);
    const res = await owner.client.post(`${base(owner.business.id)}/cards/${cardId}/redeem`, {
      rewardId: program.rewards[0]!.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("INSUFFICIENT_POINTS");
  });

  it("redeems, deducts points and records the redemption", async () => {
    const { owner, program, cardId } = await cardWithPoints(3);
    const res = await owner.client.post(`${base(owner.business.id)}/cards/${cardId}/redeem`, {
      rewardId: program.rewards[0]!.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(res.status).toBe(200);
    expect(res.json.result.pointsBalance).toBe(0);
    const redemptions = await owner.client.get(`${base(owner.business.id)}/redemptions`);
    expect(redemptions.json.redemptions).toHaveLength(1);
    expect(redemptions.json.redemptions[0].rewardName).toBe("Free coffee");
  });

  it("can't redeem the same balance twice concurrently", async () => {
    const { owner, program, cardId } = await cardWithPoints(3);
    const redeem = () =>
      owner.client.post(`${base(owner.business.id)}/cards/${cardId}/redeem`, {
        rewardId: program.rewards[0]!.id,
        idempotencyKey: crypto.randomUUID(),
      });
    const results = await Promise.all([redeem(), redeem(), redeem()]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const card = await env.DB.prepare("SELECT points_balance, rewards_redeemed FROM customer_cards WHERE id = ?").bind(cardId).first();
    expect(card).toEqual({ points_balance: 0, rewards_redeemed: 1 });
  });

  it("rejects rewards from another program", async () => {
    const { owner, cardId } = await cardWithPoints(3);
    const other = await createProgram(owner.client, owner.business.id, { name: "Other" });
    const res = await owner.client.post(`${base(owner.business.id)}/cards/${cardId}/redeem`, {
      rewardId: other.rewards[0]!.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(res.status).toBe(404);
  });
});

describe("loyalty tenant isolation & permissions", () => {
  it("prevents another business from issuing, redeeming or viewing a card", async () => {
    const { program, cardId } = await loyaltySetup();
    const other = await ownerWithBusiness();
    expect((await issueManual(other.client, other.business.id, cardId)).status).toBe(404);
    expect((await other.client.get(`${base(other.business.id)}/cards/${cardId}`)).status).toBe(404);
    const redeem = await other.client.post(`${base(other.business.id)}/cards/${cardId}/redeem`, {
      rewardId: program.rewards[0]!.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(redeem.status).toBe(404);
  });

  it("lets staff issue points but blocks staff without points.issue", async () => {
    const { owner, cardId, program } = await loyaltySetup({ dailyLimitPerCustomer: 5 });
    const staff = await inviteAndAccept(owner.client, owner.business.id, "staff");
    expect((await issueManual(staff.client, owner.business.id, cardId)).status).toBe(200);

    const list = await owner.client.get(`${base(owner.business.id)}/staff`);
    const row = list.json.staff.find((s: { email: string }) => s.email === staff.email);
    await owner.client.patch(`${base(owner.business.id)}/staff/${row.id}`, { permissions: ["customers.view"] });
    expect((await issueManual(staff.client, owner.business.id, cardId)).status).toBe(403);
    const other = await joinAsCustomer(owner.business.slug, program.id);
    expect((await issueManual(staff.client, owner.business.id, other.cardId)).status).toBe(403);
  });

  it("pins location-restricted staff to their location", async () => {
    const { owner, cardId } = await loyaltySetup();
    const loc = await owner.client.post(`${base(owner.business.id)}/locations`, { name: "Branch 2" });
    const staff = await inviteAndAccept(owner.client, owner.business.id, "staff", { locationId: loc.json.location.id });
    const mainLoc = (await owner.client.get(`${base(owner.business.id)}/locations`)).json.locations[0].id;
    await staff.client.post(`${base(owner.business.id)}/cards/${cardId}/points`, { idempotencyKey: crypto.randomUUID(), locationId: mainLoc });
    const txn = await env.DB.prepare("SELECT location_id FROM stamp_transactions WHERE card_id = ?").bind(cardId).first();
    expect(txn).toEqual({ location_id: loc.json.location.id });
  });

  it("finds cards by phone only within the business", async () => {
    const { owner, phone } = await loyaltySetup();
    const other = await ownerWithBusiness();
    const mine = await owner.client.get(`${base(owner.business.id)}/lookup?phone=${phone}`);
    expect(mine.json.cards).toHaveLength(1);
    const theirs = await other.client.get(`${base(other.business.id)}/lookup?phone=${phone}`);
    expect(theirs.json.cards).toHaveLength(0);
  });
});

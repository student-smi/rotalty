import { describe, expect, it } from "vitest";
import { createProgram, inviteAndAccept, issueManual, joinAsCustomer, ownerWithBusiness } from "./helpers";

async function scenario() {
  const owner = await ownerWithBusiness("professional");
  const bid = owner.business.id;
  const program = await createProgram(owner.client, bid, {
    stampsRequired: 5,
    dailyLimitPerCustomer: 10,
    rewards: [{ name: "Free cookie", pointsRequired: 2 }],
  });
  const a = await joinAsCustomer(owner.business.slug, program.id);
  const b = await joinAsCustomer(owner.business.slug, program.id);

  for (let i = 0; i < 3; i++) expect((await issueManual(owner.client, bid, a.cardId)).status).toBe(200);
  const redeem = await owner.client.post(`/api/businesses/${bid}/cards/${a.cardId}/redeem`, {
    rewardId: program.rewards[0]!.id,
    idempotencyKey: crypto.randomUUID(),
  });
  expect(redeem.status).toBe(200);

  const key = crypto.randomUUID();
  expect((await owner.client.post(`/api/businesses/${bid}/cards/${b.cardId}/points`, { idempotencyKey: key })).status).toBe(200);
  expect((await owner.client.post(`/api/businesses/${bid}/cards/${b.cardId}/points`, { idempotencyKey: key })).status).toBe(409);
  return { owner, bid, program };
}

describe("business analytics", () => {
  it("reports exact basic and advanced numbers", async () => {
    const { owner, bid } = await scenario();
    const res = await owner.client.get(`/api/businesses/${bid}/analytics/overview?days=30`);
    expect(res.status).toBe(200);
    const d = res.json;
    expect(d).toMatchObject({
      days: 30,
      totalCustomers: 2,
      newCustomers: 2,
      returningCustomers: 1,
      totalVisits: 4,
      pointsIssued: 4,
      rewardsUnlocked: 1,
      rewardsRedeemed: 1,
      retentionRate: 50,
      advancedAvailable: true,
    });
    expect(d.daily).toHaveLength(30);
    expect(d.daily.at(-1).visits).toBe(4);
    expect(d.weekly.reduce((s: number, w: { visits: number }) => s + w.visits, 0)).toBe(4);
    expect(d.monthly.reduce((s: number, m: { visits: number }) => s + m.visits, 0)).toBe(4);

    expect(d.advanced.channels).toEqual({ qr: 0, nfc_tag: 0, nfc_phone: 0, manual: 4 });
    expect(d.advanced.duplicateAttempts).toBe(1);
    expect(d.advanced.failuresByReason).toEqual([{ reason: "DUPLICATE", count: 1 }]);
    expect(d.advanced.programs[0]).toMatchObject({ cards: 2, visits: 4, redemptions: 1 });
    const thisWeek = d.advanced.customerTrend.at(-1);
    expect(thisWeek.newCustomers).toBe(2);
  });

  it("supports 90 days on plans with advanced analytics", async () => {
    const { owner, bid } = await scenario();
    const res = await owner.client.get(`/api/businesses/${bid}/analytics/overview?days=90`);
    expect(res.status).toBe(200);
    expect(res.json.daily).toHaveLength(90);
  });

  it("limits the Free plan to basic analytics", async () => {
    const owner = await ownerWithBusiness("free");
    const bid = owner.business.id;
    const basic = await owner.client.get(`/api/businesses/${bid}/analytics/overview?days=30`);
    expect(basic.status).toBe(200);
    expect(basic.json.advancedAvailable).toBe(false);
    expect(basic.json.advanced).toBeNull();
    expect(basic.json.totalVisits).toBe(0);

    const ninety = await owner.client.get(`/api/businesses/${bid}/analytics/overview?days=90`);
    expect(ninety.status).toBe(403);
    expect(ninety.json.error.code).toBe("PLAN_LIMIT_REACHED");
  });

  it("rejects unsupported ranges", async () => {
    const owner = await ownerWithBusiness();
    expect((await owner.client.get(`/api/businesses/${owner.business.id}/analytics/overview?days=45`)).status).toBe(400);
  });

  it("isolates tenants and enforces the analytics permission", async () => {
    const { owner, bid } = await scenario();
    const other = await ownerWithBusiness();
    expect((await other.client.get(`/api/businesses/${bid}/analytics/overview`)).status).toBe(404);
    const otherStats = await other.client.get(`/api/businesses/${other.business.id}/analytics/overview`);
    expect(otherStats.json.totalVisits).toBe(0);

    const staff = await inviteAndAccept(owner.client, bid, "staff");
    expect((await staff.client.get(`/api/businesses/${bid}/analytics/overview`)).status).toBe(403);
  });
});

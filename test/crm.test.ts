import { describe, expect, it } from "vitest";
import { createProgram, env, inviteAndAccept, issueManual, joinAsCustomer, ownerWithBusiness } from "./helpers";
import { csvCell } from "../src/worker/routes/crm";

async function issueTimes(client: Parameters<typeof issueManual>[0], businessId: string, cardId: string, n: number) {
  for (let i = 0; i < n; i++) {
    const res = await issueManual(client, businessId, cardId);
    if (res.status !== 200) throw new Error(`issue failed ${res.status} ${JSON.stringify(res.json)}`);
  }
}

/** Four customers: new (0 visits), regular (3), loyal (10, reward eligible), inactive (joined & last visit 60 days ago). */
async function crmSetup() {
  const owner = await ownerWithBusiness();
  const bid = owner.business.id;
  const program = await createProgram(owner.client, bid, {
    stampsRequired: 20,
    dailyLimitPerCustomer: 20,
    rewards: [{ name: "Free coffee", pointsRequired: 5 }],
  });
  const a = await joinAsCustomer(owner.business.slug, program.id, { name: "Aarav Newbie" });
  const b = await joinAsCustomer(owner.business.slug, program.id, { name: "Bhavna Regular", whatsappConsent: true });
  const cc = await joinAsCustomer(owner.business.slug, program.id, { name: "Chirag Loyal", whatsappConsent: true });
  const d = await joinAsCustomer(owner.business.slug, program.id, { name: "Disha Gone" });
  await issueTimes(owner.client, bid, b.cardId, 3);
  await issueTimes(owner.client, bid, cc.cardId, 10);
  await issueTimes(owner.client, bid, d.cardId, 1);
  const sixtyDaysAgo = Date.now() - 60 * 86400_000;
  await env.DB.prepare("UPDATE customer_cards SET created_at = ?1, last_visit_at = ?1 WHERE id = ?2").bind(sixtyDaysAgo, d.cardId).run();
  return { owner, bid, program, a, b, c: cc, d };
}

describe("customer CRM", () => {
  it("computes segments, stats and filters", async () => {
    const { owner, bid } = await crmSetup();
    const stats = await owner.client.get(`/api/businesses/${bid}/customers/stats`);
    expect(stats.status).toBe(200);
    expect(stats.json.stats).toMatchObject({ total: 4, new: 3, regular: 1, loyal: 1, inactive: 1, reward_eligible: 1, optedIn: 2 });

    const names = async (segment: string) =>
      (await owner.client.get(`/api/businesses/${bid}/customers?segment=${segment}`)).json.customers.map((x: { name: string }) => x.name).sort();
    expect(await names("loyal")).toEqual(["Chirag Loyal"]);
    expect(await names("regular")).toEqual(["Bhavna Regular"]);
    expect(await names("reward_eligible")).toEqual(["Chirag Loyal"]);
    expect(await names("inactive")).toEqual(["Disha Gone"]);
    expect(await names("new")).toEqual(["Aarav Newbie", "Bhavna Regular", "Chirag Loyal"]);

    const all = await owner.client.get(`/api/businesses/${bid}/customers`);
    const chirag = all.json.customers.find((x: { name: string }) => x.name === "Chirag Loyal");
    expect(chirag).toMatchObject({ visits: 10, pointsBalance: 10, lifetimePoints: 10, whatsappOptIn: true });
    expect(chirag.segments.sort()).toEqual(["loyal", "new", "reward_eligible"]);
  });

  it("searches by name and phone", async () => {
    const { owner, bid, b } = await crmSetup();
    const byName = await owner.client.get(`/api/businesses/${bid}/customers?q=bhav`);
    expect(byName.json.customers.map((x: { name: string }) => x.name)).toEqual(["Bhavna Regular"]);
    const byPhone = await owner.client.get(`/api/businesses/${bid}/customers?q=${b.phone.slice(-6)}`);
    expect(byPhone.json.customers.map((x: { phone: string }) => x.phone)).toEqual([b.phone]);
  });

  it("isolates customer details between businesses", async () => {
    const { owner, bid } = await crmSetup();
    const list = await owner.client.get(`/api/businesses/${bid}/customers?q=chirag`);
    const id = list.json.customers[0].id;
    const detail = await owner.client.get(`/api/businesses/${bid}/customers/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.cards).toHaveLength(1);
    expect(detail.json.history.length).toBe(10);

    const other = await ownerWithBusiness();
    expect((await other.client.get(`/api/businesses/${other.business.id}/customers/${id}`)).status).toBe(404);
    expect((await other.client.get(`/api/businesses/${bid}/customers/${id}`)).status).toBe(404);
    const otherList = await other.client.get(`/api/businesses/${other.business.id}/customers`);
    expect(otherList.json.customers).toEqual([]);
  });

  it("requires customers.export and neutralises CSV injection", async () => {
    const owner = await ownerWithBusiness();
    const bid = owner.business.id;
    const program = await createProgram(owner.client, bid);
    await joinAsCustomer(owner.business.slug, program.id, { name: "=HYPERLINK(\"http://evil\")" });

    const staff = await inviteAndAccept(owner.client, bid, "staff", { permissions: ["customers.view"] });
    expect((await staff.client.get(`/api/businesses/${bid}/customers`)).status).toBe(200);
    expect((await staff.client.get(`/api/businesses/${bid}/customers/export`)).status).toBe(403);

    const res = await owner.client.get(`/api/businesses/${bid}/customers/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = res.json as string;
    expect(text).toContain('"Name","Phone"');
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell("+91")).toBe(`"'+91"`);
    expect(csvCell("plain")).toBe(`"plain"`);

    const audit = await env.DB.prepare("SELECT count(*) AS n FROM audit_logs WHERE business_id = ? AND action = 'customers.exported'").bind(bid).first<{ n: number }>();
    expect(audit!.n).toBe(1);
  });

  it("lets a business record a withdrawal but never grant consent", async () => {
    const { owner, bid, b } = await crmSetup();
    const id = (await owner.client.get(`/api/businesses/${bid}/customers?q=bhav`)).json.customers[0].id;
    const grant = await owner.client.request("PUT", `/api/businesses/${bid}/customers/${id}/consents/whatsapp`, { action: "grant" });
    expect(grant.status).toBe(400);

    const withdraw = await owner.client.request("PUT", `/api/businesses/${bid}/customers/${id}/consents/whatsapp`, { action: "withdraw" });
    expect(withdraw.status).toBe(200);
    const detail = await owner.client.get(`/api/businesses/${bid}/customers/${id}`);
    expect(detail.json.consents.find((x: { channel: string }) => x.channel === "whatsapp")).toMatchObject({ status: "withdrawn", source: "business_on_request" });
    expect(detail.json.customer.whatsappOptIn).toBe(false);

    // The customer can still opt back in themselves.
    const consents = await b.customer.get("/api/c/consents");
    expect(consents.json.businesses[0].channels.whatsapp).toBe(false);
  });

  it("blocks and unblocks cards", async () => {
    const { owner, bid, a } = await crmSetup();
    expect((await owner.client.patch(`/api/businesses/${bid}/cards/${a.cardId}`, { status: "blocked" })).status).toBe(200);
    const blocked = await issueManual(owner.client, bid, a.cardId);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe("CARD_BLOCKED");
    await owner.client.patch(`/api/businesses/${bid}/cards/${a.cardId}`, { status: "active" });
    expect((await issueManual(owner.client, bid, a.cardId)).status).toBe(200);

    const other = await ownerWithBusiness();
    expect((await other.client.patch(`/api/businesses/${other.business.id}/cards/${a.cardId}`, { status: "blocked" })).status).toBe(404);
  });
});

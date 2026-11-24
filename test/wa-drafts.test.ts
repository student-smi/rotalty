import { describe, expect, it } from "vitest";
import { createProgram, env, inviteAndAccept, issueManual, joinAsCustomer, ownerWithBusiness } from "./helpers";
import { IST_OFFSET_MS } from "../src/shared/domain";

async function shopWithCustomers() {
  const owner = await ownerWithBusiness();
  const program = await createProgram(owner.client, owner.business.id, {
    stampsRequired: 5,
    rewards: [
      { name: "Free tea", pointsRequired: 2 },
      { name: "Free coffee", pointsRequired: 5 },
    ],
  });
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const today = `${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
  const yes = await joinAsCustomer(owner.business.slug, program.id, { name: "Riya Shah", whatsappConsent: true, birthday: today });
  const no = await joinAsCustomer(owner.business.slug, program.id, { name: "Amit Patel" });
  return { owner, program, yes, no, base: `/api/businesses/${owner.business.id}` };
}

describe("WhatsApp draft messages", () => {
  it("only lists customers who agreed to WhatsApp, with their stamps and next reward", async () => {
    const { owner, yes, base } = await shopWithCustomers();
    await issueManual(owner.client, owner.business.id, yes.cardId);
    const res = await owner.client.get(`${base}/wa/audience`);
    expect(res.status).toBe(200);
    expect(res.json.recipients).toHaveLength(1);
    expect(res.json.recipients[0]).toMatchObject({ name: "Riya Shah", phone: yes.phone, stamps: 1, stampsRequired: 5, nextReward: "Free tea", stampsToNext: 1, readyReward: null });
  });

  it("builds today's list: birthdays and waiting rewards, skipping anyone messaged this week", async () => {
    const { owner, yes, base } = await shopWithCustomers();
    await issueManual(owner.client, owner.business.id, yes.cardId);
    await env.DB.prepare("UPDATE customer_cards SET points_balance = 2 WHERE id = ?").bind(yes.cardId).run();

    const today = await owner.client.get(`${base}/wa/today`);
    expect(today.json.birthdays.map((r: { name: string }) => r.name)).toEqual(["Riya Shah"]);
    expect(today.json.rewardReady[0]).toMatchObject({ readyReward: "Free tea" });

    const customerId = today.json.birthdays[0].customerId;
    expect((await owner.client.post(`${base}/wa/log`, { customerId, kind: "birthday" })).status).toBe(200);
    const after = await owner.client.get(`${base}/wa/today`);
    expect(after.json.birthdays).toEqual([]);
    expect(after.json.rewardReady).toEqual([]);
    expect((await owner.client.get(`${base}/wa/audience`)).json.recipients[0].lastMessagedAt).toBeGreaterThan(0);
  });

  it("returns nothing for a customer who didn't opt in, and won't log a message to them", async () => {
    const { owner, no, base } = await shopWithCustomers();
    const customerId = (await env.DB.prepare("SELECT id FROM customers WHERE phone = ?").bind(no.phone).first<{ id: string }>())!.id;
    expect((await owner.client.get(`${base}/wa/customers/${customerId}`)).json.recipient).toBeNull();
    expect((await owner.client.post(`${base}/wa/log`, { customerId, kind: "thanks" })).status).toBe(404);
  });

  it("lets counter staff send a thank-you but not open the marketing lists", async () => {
    const { owner, yes, base } = await shopWithCustomers();
    const staff = (await inviteAndAccept(owner.client, owner.business.id, "staff")).client;
    const customerId = (await env.DB.prepare("SELECT id FROM customers WHERE phone = ?").bind(yes.phone).first<{ id: string }>())!.id;
    expect((await staff.get(`${base}/wa/customers/${customerId}`)).json.recipient).toMatchObject({ name: "Riya Shah" });
    expect((await staff.post(`${base}/wa/log`, { customerId, kind: "thanks" })).status).toBe(200);
    expect((await staff.get(`${base}/wa/audience`)).status).toBe(403);
  });

  it("never shows another shop's customers", async () => {
    const { yes } = await shopWithCustomers();
    const other = await ownerWithBusiness();
    const customerId = (await env.DB.prepare("SELECT id FROM customers WHERE phone = ?").bind(yes.phone).first<{ id: string }>())!.id;
    expect((await other.client.get(`/api/businesses/${other.business.id}/wa/customers/${customerId}`)).json.recipient).toBeNull();
    expect((await other.client.get(`/api/businesses/${other.business.id}/wa/audience`)).json.recipients).toEqual([]);
  });
});

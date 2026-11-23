import { describe, expect, it } from "vitest";
import { env, joinAsCustomer, loyaltySetup, ownerWithBusiness, createProgram, TestClient } from "./helpers";
import { createCardToken } from "../src/worker/services/card-token";

const base = (bid: string) => `/api/businesses/${bid}`;

async function cardToken(customer: TestClient, cardId: string) {
  const res = await customer.post(`/api/c/cards/${cardId}/token`);
  expect(res.status).toBe(200);
  return res.json.token as string;
}

describe("rotating card QR", () => {
  it("issues a point once per token", async () => {
    const { owner, customer, cardId } = await loyaltySetup({ dailyLimitPerCustomer: 5 });
    const token = await cardToken(customer, cardId);
    expect(token.startsWith("LRC1:")).toBe(true);

    const first = await owner.client.post(`${base(owner.business.id)}/issue/scan`, { token });
    expect(first.status).toBe(200);
    expect(first.json.result.pointsBalance).toBe(1);

    const replay = await owner.client.post(`${base(owner.business.id)}/issue/scan`, { token });
    expect(replay.status).toBe(409);
    expect(replay.json.error.code).toBe("DUPLICATE");
  });

  it("rejects tampered and expired tokens", async () => {
    const { owner, customer, cardId } = await loyaltySetup();
    const token = await cardToken(customer, cardId);
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "BB" : "AA");
    const bad = await owner.client.post(`${base(owner.business.id)}/issue/scan`, { token: tampered });
    expect(bad.json.error.code).toBe("TOKEN_INVALID");

    const old = await createCardToken(env.BETTER_AUTH_SECRET, cardId, Date.now() - 10 * 60_000);
    const expired = await owner.client.post(`${base(owner.business.id)}/issue/scan`, { token: old.token });
    expect(expired.json.error.code).toBe("TOKEN_EXPIRED");

    const forged = await createCardToken("some-other-secret-value-xxxxxxxxxxxx", cardId);
    expect((await owner.client.post(`${base(owner.business.id)}/issue/scan`, { token: forged.token })).json.error.code).toBe("TOKEN_INVALID");
  });

  it("can't be used at a different business", async () => {
    const { customer, cardId } = await loyaltySetup();
    const other = await ownerWithBusiness();
    const token = await cardToken(customer, cardId);
    const res = await other.client.post(`${base(other.business.id)}/issue/scan`, { token });
    expect(res.status).toBe(404);
  });

  it("only the card's owner can get a token", async () => {
    const { owner, program, cardId } = await loyaltySetup();
    const stranger = await joinAsCustomer(owner.business.slug, program.id);
    expect((await stranger.customer.post(`/api/c/cards/${cardId}/token`)).status).toBe(404);
    expect((await new TestClient().post(`/api/c/cards/${cardId}/token`)).status).toBe(401);
  });

  it("respects the QR channel switch", async () => {
    const { owner, customer, cardId } = await loyaltySetup();
    await owner.client.patch(`${base(owner.business.id)}/channels`, { qrEnabled: false });
    const res = await owner.client.post(`${base(owner.business.id)}/issue/scan`, { token: await cardToken(customer, cardId) });
    expect(res.json.error.code).toBe("CHANNEL_DISABLED");
  });

  it("resolves a token to the card for redemption without issuing", async () => {
    const { owner, customer, cardId } = await loyaltySetup();
    const res = await owner.client.post(`${base(owner.business.id)}/cards/resolve`, { token: await cardToken(customer, cardId) });
    expect(res.status).toBe(200);
    expect(res.json.card.id).toBe(cardId);
    expect(res.json.card.pointsBalance).toBe(0);
  });
});

describe("business QR codes", () => {
  it("creates, tracks, rotates and revokes printed QR codes", async () => {
    const { client, business } = await ownerWithBusiness();
    const created = await client.post(`${base(business.id)}/qr-codes`, { label: "Counter poster" });
    expect(created.status).toBe(201);
    const { id, code, url } = created.json.qrCode;
    expect(url).toContain(`/q/${code}`);

    const scan = await client.get(`/q/${code}`);
    expect(scan.status).toBe(302);
    expect(scan.headers.get("location")).toBe(`/s/${business.slug}?via=qr`);
    await new Promise((r) => setTimeout(r, 50));
    const row = await env.DB.prepare("SELECT scan_count FROM qr_codes WHERE id = ?").bind(id).first();
    expect(row).toEqual({ scan_count: 1 });

    const rotated = await client.post(`${base(business.id)}/qr-codes/${id}/rotate`);
    expect(rotated.json.qrCode.code).not.toBe(code);
    expect((await client.get(`/q/${code}`)).headers.get("location")).toBe(`/s/${business.slug}?link=expired`);
    expect((await client.get(`/q/${rotated.json.qrCode.code}`)).headers.get("location")).toBe(`/s/${business.slug}?via=qr`);
    expect((await client.get(`/q/doesnotexist`)).headers.get("location")).toBe("/link-invalid");
  });

  it("doesn't let another business revoke a QR code", async () => {
    const a = await ownerWithBusiness();
    const b = await ownerWithBusiness();
    const qr = await a.client.post(`${base(a.business.id)}/qr-codes`, { label: "Poster" });
    expect((await b.client.post(`${base(b.business.id)}/qr-codes/${qr.json.qrCode.id}/revoke`)).status).toBe(404);
  });
});

describe("NFC tags", () => {
  async function nfcSetup() {
    const setup = await loyaltySetup({ dailyLimitPerCustomer: 5 });
    const b = base(setup.owner.business.id);
    await setup.owner.client.patch(`${b}/channels`, { nfcTagEnabled: true });
    const tag = await setup.owner.client.post(`${b}/nfc-tags`, { label: "Counter tag" });
    expect(tag.status).toBe(201);
    return { ...setup, tag: tag.json.nfcTag as { id: string; code: string; url: string } };
  }

  it("is not available on the Free plan", async () => {
    const { client, business } = await ownerWithBusiness("free");
    expect((await client.patch(`${base(business.id)}/channels`, { nfcTagEnabled: true })).json.error.code).toBe("PLAN_LIMIT_REACHED");
    expect((await client.post(`${base(business.id)}/nfc-tags`, { label: "Tag" })).status).toBe(403);
  });

  it("refuses to enable phone-to-phone NFC in the web app", async () => {
    const { client, business } = await ownerWithBusiness();
    const res = await client.patch(`${base(business.id)}/channels`, { nfcPhoneEnabled: true });
    expect(res.json.error.code).toBe("NFC_PHONE_UNSUPPORTED");
  });

  it("a tag tap only opens the page; it never issues a point by itself", async () => {
    const { owner, cardId, tag } = await nfcSetup();
    const tap = await new TestClient().get(`/t/${tag.code}`);
    expect(tap.status).toBe(302);
    expect(tap.headers.get("location")).toBe(`/s/${owner.business.slug}?tag=${tag.code}`);
    const card = await env.DB.prepare("SELECT points_balance FROM customer_cards WHERE id = ?").bind(cardId).first();
    expect(card).toEqual({ points_balance: 0 });
  });

  it("issues a point only after staff approve the customer's request", async () => {
    const { owner, customer, cardId, tag } = await nfcSetup();
    const req = await customer.post("/api/c/nfc-requests", { tagCode: tag.code, cardId });
    expect(req.status).toBe(201);
    expect(req.json.request.shortCode).toMatch(/^\d{4}$/);

    const again = await customer.post("/api/c/nfc-requests", { tagCode: tag.code, cardId });
    expect(again.json.request.id).toBe(req.json.request.id);

    const pending = await owner.client.get(`${base(owner.business.id)}/nfc-requests`);
    expect(pending.json.requests.map((r: { id: string }) => r.id)).toContain(req.json.request.id);

    const approve = await owner.client.post(`${base(owner.business.id)}/nfc-requests/${req.json.request.id}/approve`);
    expect(approve.status).toBe(200);
    expect(approve.json.result.pointsBalance).toBe(1);
    const txn = await env.DB.prepare("SELECT channel, nfc_tag_id FROM stamp_transactions WHERE card_id = ?").bind(cardId).first();
    expect(txn).toEqual({ channel: "nfc_tag", nfc_tag_id: tag.id });

    const status = await customer.get(`/api/c/nfc-requests/${req.json.request.id}`);
    expect(status.json.request.status).toBe("approved");
    expect((await owner.client.post(`${base(owner.business.id)}/nfc-requests/${req.json.request.id}/approve`)).status).toBe(409);
  });

  it("handles rejected and expired requests", async () => {
    const { owner, customer, cardId, tag } = await nfcSetup();
    const r1 = await customer.post("/api/c/nfc-requests", { tagCode: tag.code, cardId });
    await owner.client.post(`${base(owner.business.id)}/nfc-requests/${r1.json.request.id}/reject`);
    expect((await customer.get(`/api/c/nfc-requests/${r1.json.request.id}`)).json.request.status).toBe("rejected");

    const r2 = await customer.post("/api/c/nfc-requests", { tagCode: tag.code, cardId });
    await env.DB.prepare("UPDATE nfc_sessions SET expires_at = ? WHERE id = ?").bind(Date.now() - 1000, r2.json.request.id).run();
    const late = await owner.client.post(`${base(owner.business.id)}/nfc-requests/${r2.json.request.id}/approve`);
    expect(late.json.error.code).toBe("REQUEST_EXPIRED");
    const card = await env.DB.prepare("SELECT points_balance FROM customer_cards WHERE id = ?").bind(cardId).first();
    expect(card).toEqual({ points_balance: 0 });
  });

  it("rejects revoked tags and tags from another business", async () => {
    const { owner, customer, cardId, tag } = await nfcSetup();
    const b = base(owner.business.id);
    const replaced = await owner.client.post(`${b}/nfc-tags/${tag.id}/replace`);
    expect(replaced.json.nfcTag.code).not.toBe(tag.code);
    const old = await customer.post("/api/c/nfc-requests", { tagCode: tag.code, cardId });
    expect(old.json.error.code).toBe("TAG_INVALID");
    expect((await new TestClient().get(`/t/${tag.code}`)).headers.get("location")).toBe(`/s/${owner.business.slug}?link=expired`);

    const other = await ownerWithBusiness();
    await other.client.patch(`${base(other.business.id)}/channels`, { nfcTagEnabled: true });
    await createProgram(other.client, other.business.id);
    const otherTag = await other.client.post(`${base(other.business.id)}/nfc-tags`, { label: "Other" });
    const cross = await customer.post("/api/c/nfc-requests", { tagCode: otherTag.json.nfcTag.code, cardId });
    expect(cross.status).toBe(400);
  });

  it("shows NFC history to the owner", async () => {
    const { owner, customer, cardId, tag } = await nfcSetup();
    const r = await customer.post("/api/c/nfc-requests", { tagCode: tag.code, cardId });
    await owner.client.post(`${base(owner.business.id)}/nfc-requests/${r.json.request.id}/approve`);
    const history = await owner.client.get(`${base(owner.business.id)}/nfc-history`);
    expect(history.json.history[0]).toMatchObject({ status: "approved", tagLabel: "Counter tag" });
  });
});

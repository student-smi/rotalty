import { beforeEach, describe, expect, it } from "vitest";
import { env, signUp, TestClient } from "./helpers";

const DAY = 86_400_000;
let admin: Awaited<ReturnType<typeof signUp>>;

async function makeAdmin() {
  const a = await signUp("Admin");
  await env.DB.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").bind(a.userId).run();
  return a;
}

beforeEach(async () => {
  // Settings are platform-wide: start every test from "not set up".
  await env.DB.prepare("DELETE FROM platform_settings WHERE key IN ('upiId','upiPayeeName','paymentMethod','provisionalAccess')").run();
  admin = await makeAdmin();
});

const setUpi = (extra: Record<string, unknown> = {}) =>
  admin.client.request("PUT", "/api/admin/settings", { upiId: "repeatly@ybl", upiPayeeName: "Repeatly", paymentMethod: "upi", ...extra });

function submit(client: TestClient, reference: string, utr: string, proof?: Blob) {
  const form = new FormData();
  form.set("reference", reference);
  form.set("utr", utr);
  if (proof) form.set("proof", proof, "proof.png");
  return client.request("POST", "/api/billing/upi/submit", undefined, { body: form });
}

const utr = () => String(Math.floor(1e11 + Math.random() * 9e11));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("manual UPI payments", () => {
  it("defaults to 'request a plan'; UPI turns on only when chosen with a UPI ID", async () => {
    const owner = await signUp();
    expect((await owner.client.get("/api/billing/plans")).json.paymentMethod).toBe("contact");
    expect((await owner.client.post("/api/billing/upi/start", { planCode: "starter" })).status).toBe(503);
    expect((await admin.client.request("PUT", "/api/admin/settings", { upiId: "not a upi id" })).status).toBe(400);
    expect((await setUpi()).status).toBe(200);
    expect((await owner.client.get("/api/billing/plans")).json.paymentMethod).toBe("upi");
  });

  it("gives a reference and a UPI link with the right amount, reusing the reference on refresh", async () => {
    await setUpi();
    const owner = await signUp();
    const res = await owner.client.post("/api/billing/upi/start", { planCode: "starter" });
    expect(res.status).toBe(200);
    expect(res.json.reference).toMatch(/^RP-[A-Z0-9]{6}$/);
    const uri = new URL(res.json.upiUri);
    expect(uri.protocol).toBe("upi:");
    expect(Object.fromEntries(uri.searchParams)).toMatchObject({ pa: "repeatly@ybl", pn: "Repeatly", am: "499.00", cu: "INR", tr: res.json.reference });
    expect((await owner.client.post("/api/billing/upi/start", { planCode: "starter" })).json.reference).toBe(res.json.reference);
    expect((await owner.client.post("/api/billing/upi/start", { planCode: "free" })).status).toBe(400);
  });

  it("gives 48-hour access after the UTR, then the full plan when a Super Admin approves", async () => {
    await setUpi();
    const owner = await signUp();
    const { reference } = (await owner.client.post("/api/billing/upi/start", { planCode: "starter" })).json;
    const sent = await submit(owner.client, reference, utr(), new Blob([PNG], { type: "image/png" }));
    expect(sent.status).toBe(200);
    expect(new Date(sent.json.provisionalUntil).getTime() - Date.now()).toBeGreaterThan(47 * 3_600_000);

    const during = await owner.client.get("/api/billing/subscription");
    expect(during.json.plan.code).toBe("starter");

    const pending = await admin.client.get("/api/admin/upi-payments");
    const row = pending.json.payments.find((p: { reference: string }) => p.reference === reference);
    expect(row).toMatchObject({ status: "created", planName: "Starter", amountPaise: 49900, hasProof: true });
    const proof = await admin.client.get(`/api/admin/upi-payments/${row.id}/proof`);
    expect(proof.status).toBe(200);
    expect(proof.headers.get("content-type")).toBe("image/png");

    expect((await owner.client.post(`/api/admin/upi-payments/${row.id}/approve`, {})).status).toBe(403);
    const ok = await admin.client.post(`/api/admin/upi-payments/${row.id}/approve`, {});
    expect(ok.status).toBe(200);
    // Full 30 days from approval; the 48 hours don't add on top.
    const days = (new Date(ok.json.periodEnd).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    const history = await owner.client.get("/api/billing/payments");
    expect(history.json.payments[0]).toMatchObject({ status: "paid", provider: "upi_manual", orderId: reference });
    expect((await admin.client.post(`/api/admin/upi-payments/${row.id}/approve`, {})).status).toBe(409);
  });

  it("rejecting takes back the 48-hour access, and the access is only given once", async () => {
    await setUpi();
    const owner = await signUp();
    const first = (await owner.client.post("/api/billing/upi/start", { planCode: "starter" })).json.reference;
    await submit(owner.client, first, utr());
    const id = (await admin.client.get("/api/admin/upi-payments")).json.payments.find((p: { reference: string }) => p.reference === first).id;
    expect((await admin.client.post(`/api/admin/upi-payments/${id}/reject`, { reason: "UTR not found in bank statement" })).json.provisionalRevoked).toBe(true);
    expect((await owner.client.get("/api/billing/subscription")).json.plan.code).toBe("free");
    expect((await owner.client.get("/api/billing/payments")).json.payments[0]).toMatchObject({ status: "failed", failureReason: "UTR not found in bank statement" });

    const second = (await owner.client.post("/api/billing/upi/start", { planCode: "starter" })).json.reference;
    expect(second).not.toBe(first);
    expect((await submit(owner.client, second, utr())).json.provisionalUntil).toBeNull();
  });

  it("never accepts the same UTR twice, or a second submit for one payment", async () => {
    await setUpi();
    const a = await signUp();
    const b = await signUp();
    const shared = utr();
    const refA = (await a.client.post("/api/billing/upi/start", { planCode: "starter" })).json.reference;
    const refB = (await b.client.post("/api/billing/upi/start", { planCode: "starter" })).json.reference;
    expect((await submit(a.client, refA, shared)).status).toBe(200);
    const dup = await submit(b.client, refB, shared);
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("UTR_USED");
    expect((await submit(a.client, refA, utr())).status).toBe(409);
    expect((await submit(b.client, refA, utr())).status).toBe(404); // someone else's reference
    expect((await submit(b.client, refB, "12")).status).toBe(400);
  });

  it("doesn't give 48-hour access to someone already on a paid plan, or when switched off", async () => {
    await setUpi({ provisionalAccess: false });
    const owner = await signUp();
    const ref = (await owner.client.post("/api/billing/upi/start", { planCode: "starter" })).json.reference;
    expect((await submit(owner.client, ref, utr())).json.provisionalUntil).toBeNull();
    expect((await owner.client.get("/api/billing/subscription")).json.plan.code).toBe("free");

    await setUpi({ provisionalAccess: true });
    const paid = await signUp();
    await env.DB.prepare("INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, 'plan_starter', 'active', ?, 0, 0)")
      .bind(crypto.randomUUID(), paid.userId, Date.now() + 10 * DAY)
      .run();
    const ref2 = (await paid.client.post("/api/billing/upi/start", { planCode: "professional" })).json.reference;
    expect((await submit(paid.client, ref2, utr())).json.provisionalUntil).toBeNull();
    expect((await paid.client.get("/api/billing/subscription")).json.plan.code).toBe("starter");
  });
});

describe("request a plan (Super Admin collects payment)", () => {
  it("sends the request to the Support Inbox once per day, with the shop's WhatsApp number", async () => {
    const { ownerWithBusiness } = await import("./helpers");
    const o = await ownerWithBusiness("free");
    await o.client.patch(`/api/businesses/${o.business.id}`, { whatsappNumber: "98765 43210" });
    const first = await o.client.post("/api/billing/plan-request", { planCode: "starter" });
    expect(first.json).toEqual({ ok: true, alreadyRequested: false });
    expect((await o.client.post("/api/billing/plan-request", { planCode: "starter" })).json.alreadyRequested).toBe(true);
    expect((await o.client.post("/api/billing/plan-request", { planCode: "free" })).status).toBe(404);

    const inbox = await admin.client.get("/api/admin/support");
    const mine = inbox.json.messages.filter((m: { contact: string }) => m.contact === "9876543210");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ topic: "shop_owner", businessName: o.business.name });
    expect(mine[0].message).toContain("Plan request: Starter");
    expect((await o.client.post("/api/billing/upi/start", { planCode: "starter" })).status).toBe(503);
  });
});

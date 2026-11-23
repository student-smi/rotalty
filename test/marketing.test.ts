import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram, env, issueManual, joinAsCustomer, ownerWithBusiness, TestClient } from "./helpers";
import { createDb } from "../src/worker/db/client";
import { processOutbox, runDailyAutomations } from "../src/worker/services/marketing-cron";
import { istDateString } from "../src/shared/domain";

/**
 * The `env` object from "cloudflare:workers" is the same object the Worker receives in this isolate,
 * so setting WhatsApp secrets on it turns the integration on for both route calls and direct service calls.
 */
const WA = { WHATSAPP_TOKEN: "test-token", WHATSAPP_PHONE_NUMBER_ID: "1234567890", WHATSAPP_APP_SECRET: "app-secret", WHATSAPP_VERIFY_TOKEN: "verify-me" };
const mutableEnv = env as unknown as Record<string, unknown>;
const configureWhatsApp = () => Object.assign(mutableEnv, WA);

type GraphReply = { status: number; body: unknown };
let graphReplies: (() => GraphReply)[] = [];
let graphCalls: { url: string; body: any }[] = [];
let msgCounter = 0;
const ok = (): GraphReply => ({ status: 200, body: { messages: [{ id: `wamid.${crypto.randomUUID()}.${++msgCounter}` }] } });

beforeEach(() => {
  graphReplies = [];
  graphCalls = [];
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("graph.facebook.com")) return realFetch(input, init);
    graphCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    const reply = (graphReplies.shift() ?? ok)();
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(WA)) delete mutableEnv[k];
});

const db = () => createDb(env.DB);

async function marketingSetup(plan: "free" | "professional" = "professional") {
  const owner = await ownerWithBusiness(plan);
  const bid = owner.business.id;
  const program = await createProgram(owner.client, bid, { stampsRequired: 3, dailyLimitPerCustomer: 5, rewards: [{ name: "Free juice", pointsRequired: 2 }] });
  return { owner, bid, program };
}

async function createCampaign(client: TestClient, bid: string, body: Record<string, unknown> = {}) {
  const res = await client.post(`/api/businesses/${bid}/campaigns`, {
    name: "Diwali offer",
    type: "occasion",
    mode: "one_off",
    templateName: "diwali_offer",
    templateLanguage: "en",
    templateParams: ["{{name}}", "{{business}}", "{{points}}"],
    ...body,
  });
  if (res.status !== 201) throw new Error(`create campaign failed ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.campaign as { id: string };
}

const logsFor = (campaignId: string) =>
  env.DB.prepare("SELECT * FROM notification_logs WHERE campaign_id = ? ORDER BY created_at").bind(campaignId).all<any>().then((r) => r.results);

describe("marketing access", () => {
  it("is not available on the Free plan", async () => {
    const { owner, bid } = await marketingSetup("free");
    const res = await owner.client.post(`/api/businesses/${bid}/campaigns`, {
      name: "x campaign",
      type: "occasion",
      mode: "one_off",
      templateName: "t",
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("PLAN_LIMIT_REACHED");
    const status = await owner.client.get(`/api/businesses/${bid}/marketing/status`);
    expect(status.json).toMatchObject({ planAllows: false, whatsappConfigured: false });
  });

  it("refuses to send when WhatsApp isn't configured", async () => {
    const { owner, bid } = await marketingSetup();
    const campaign = await createCampaign(owner.client, bid);
    const res = await owner.client.post(`/api/businesses/${bid}/campaigns/${campaign.id}/send`);
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("WHATSAPP_NOT_CONFIGURED");
  });

  it("validates mode/type combinations and template names", async () => {
    const { owner, bid } = await marketingSetup();
    const bad1 = await owner.client.post(`/api/businesses/${bid}/campaigns`, { name: "bday", type: "birthday", mode: "one_off", templateName: "bday" });
    expect(bad1.status).toBe(400);
    const bad2 = await owner.client.post(`/api/businesses/${bid}/campaigns`, { name: "Offer", type: "occasion", mode: "one_off", templateName: "Bad Name!" });
    expect(bad2.status).toBe(400);
  });
});

describe("one-off campaigns", () => {
  it("enqueues only customers who opted in, with resolved placeholders", async () => {
    configureWhatsApp();
    const { owner, bid, program } = await marketingSetup();
    const yes1 = await joinAsCustomer(owner.business.slug, program.id, { name: "Riya Shah", whatsappConsent: true });
    await joinAsCustomer(owner.business.slug, program.id, { name: "Karan Mehta", whatsappConsent: true });
    await joinAsCustomer(owner.business.slug, program.id, { name: "No Consent" });
    await issueManual(owner.client, bid, yes1.cardId);

    const preview = await owner.client.get(`/api/businesses/${bid}/campaigns/audience-preview`);
    expect(preview.json.count).toBe(2);

    const campaign = await createCampaign(owner.client, bid);
    const res = await owner.client.post(`/api/businesses/${bid}/campaigns/${campaign.id}/send`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "running", queued: 2, skipped: 0 });

    const logs = await logsFor(campaign.id);
    expect(logs).toHaveLength(2);
    const riya = logs.find((l) => l.recipient === `91${yes1.phone}`);
    expect(JSON.parse(riya.payload).bodyParams).toEqual(["Riya", "ABC Coffee House", "1"]);

    const again = await owner.client.post(`/api/businesses/${bid}/campaigns/${campaign.id}/send`);
    expect(again.status).toBe(409);
  });

  it("enforces the monthly message limit", async () => {
    configureWhatsApp();
    const { owner, bid, program } = await marketingSetup();
    await joinAsCustomer(owner.business.slug, program.id, { whatsappConsent: true });
    await joinAsCustomer(owner.business.slug, program.id, { whatsappConsent: true });
    const code = `tiny_${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare(
      `INSERT INTO subscription_plans (id, code, name, price_paise, interval_days, limits, is_active, sort_order, created_at, updated_at)
       VALUES (?1, ?2, 'Tiny', 0, 30, ?3, 1, 99, ?4, ?4)`,
    )
      .bind(
        crypto.randomUUID(),
        code,
        JSON.stringify({ businesses: 5, locationsPerBusiness: 5, staffPerBusiness: 5, customersPerBusiness: null, programsPerBusiness: 5, aiGenerationsPerMonth: 5, campaignMessagesPerMonth: 1, nfc: true, marketing: true, advancedAnalytics: true }),
        Date.now(),
      )
      .run();
    await env.DB.prepare("UPDATE subscriptions SET plan_id = (SELECT id FROM subscription_plans WHERE code = ?1) WHERE user_id = ?2").bind(code, owner.userId).run();

    const campaign = await createCampaign(owner.client, bid);
    const res = await owner.client.post(`/api/businesses/${bid}/campaigns/${campaign.id}/send`);
    expect(res.status).toBe(403);
    expect(res.json.error).toMatchObject({ code: "PLAN_LIMIT_REACHED", details: { remaining: 1, needed: 2 } });
    expect(await logsFor(campaign.id)).toHaveLength(0);
  });

  it("applies a 24-hour frequency cap per customer", async () => {
    configureWhatsApp();
    const { owner, bid, program } = await marketingSetup();
    await joinAsCustomer(owner.business.slug, program.id, { whatsappConsent: true });
    const first = await createCampaign(owner.client, bid);
    expect((await owner.client.post(`/api/businesses/${bid}/campaigns/${first.id}/send`)).json.queued).toBe(1);
    const second = await createCampaign(owner.client, bid, { name: "Second offer" });
    const res = await owner.client.post(`/api/businesses/${bid}/campaigns/${second.id}/send`);
    expect(res.json).toMatchObject({ queued: 0, skipped: 1, status: "completed" });
    expect((await logsFor(second.id))[0]).toMatchObject({ status: "skipped", error: "frequency_cap" });
  });

  it("cancelling a campaign skips its queued messages", async () => {
    configureWhatsApp();
    const { owner, bid, program } = await marketingSetup();
    await joinAsCustomer(owner.business.slug, program.id, { whatsappConsent: true });
    const campaign = await createCampaign(owner.client, bid);
    await owner.client.post(`/api/businesses/${bid}/campaigns/${campaign.id}/send`);
    expect((await owner.client.post(`/api/businesses/${bid}/campaigns/${campaign.id}/cancel`)).status).toBe(200);
    expect((await logsFor(campaign.id))[0]).toMatchObject({ status: "skipped", error: "cancelled" });
  });
});

describe("outbox delivery", () => {
  async function queuedCampaign() {
    configureWhatsApp();
    const { owner, bid, program } = await marketingSetup();
    const joined = await joinAsCustomer(owner.business.slug, program.id, { name: "Asha Patel", whatsappConsent: true });
    const campaign = await createCampaign(owner.client, bid);
    await owner.client.post(`/api/businesses/${bid}/campaigns/${campaign.id}/send`);
    return { owner, bid, campaign, joined };
  }

  it("sends queued messages and completes the campaign", async () => {
    const { campaign, joined, owner, bid } = await queuedCampaign();
    await processOutbox(env, db());
    const [log] = await logsFor(campaign.id);
    expect(log).toMatchObject({ status: "sent", attempts: 1 });
    expect(log.provider_message_id).toMatch(/^wamid\./);
    const call = graphCalls.find((c) => c.body.to === `91${joined.phone}`)!;
    expect(call.url).toContain("/1234567890/messages");
    expect(call.body.template).toMatchObject({ name: "diwali_offer", language: { code: "en" } });
    expect(call.body.template.components[0].parameters[0]).toEqual({ type: "text", text: "Asha" });

    const list = await owner.client.get(`/api/businesses/${bid}/campaigns`);
    const cmp = list.json.campaigns.find((x: { id: string }) => x.id === campaign.id);
    expect(cmp.status).toBe("completed");
    expect(cmp.stats).toEqual({ sent: 1 });
  });

  it("retries transient failures with backoff and fails permanent errors", async () => {
    const { campaign } = await queuedCampaign();
    graphReplies = [() => ({ status: 500, body: { error: { message: "temporary" } } })];
    await processOutbox(env, db());
    let [log] = await logsFor(campaign.id);
    expect(log).toMatchObject({ status: "queued", attempts: 1 });
    expect(log.next_attempt_at).toBeGreaterThan(Date.now() + 50_000);

    // Make it due now; a template error is permanent.
    await env.DB.prepare("UPDATE notification_logs SET next_attempt_at = ?1 WHERE id = ?2").bind(Date.now() - 1, log.id).run();
    graphReplies = [() => ({ status: 400, body: { error: { code: 132001, message: "Template name does not exist" } } })];
    await processOutbox(env, db());
    [log] = await logsFor(campaign.id);
    expect(log.status).toBe("failed");
    expect(log.attempts).toBe(2);
    expect(log.error).toContain("132001");
  });

  it("skips customers who withdrew consent after the message was queued", async () => {
    const { campaign, joined, bid } = await queuedCampaign();
    const res = await joined.customer.request("PUT", "/api/c/consents", { businessId: bid, channel: "whatsapp", granted: false });
    expect(res.status).toBe(200);
    await processOutbox(env, db());
    const [log] = await logsFor(campaign.id);
    expect(log).toMatchObject({ status: "skipped", error: "consent_withdrawn" });
    expect(graphCalls.filter((c) => c.body.to === `91${joined.phone}`)).toHaveLength(0);
  });
});

async function sign(body: string, secret = WA.WHATSAPP_APP_SECRET) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `sha256=${[...sig].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function postWebhook(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return new TestClient().request("POST", "/api/webhooks/whatsapp", undefined, {
    body,
    headers: { "Content-Type": "application/json", "x-hub-signature-256": signature ?? (await sign(body)) },
  });
}

describe("WhatsApp webhook", () => {
  it("answers the verification challenge only with the right token", async () => {
    configureWhatsApp();
    const good = await new TestClient().get("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=4242");
    expect(good.status).toBe(200);
    expect(good.json).toBe(4242);
    const bad = await new TestClient().get("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=4242");
    expect(bad.status).toBe(403);
  });

  it("rejects bad signatures and never regresses delivery status", async () => {
    configureWhatsApp();
    const { owner, bid, program } = await marketingSetup();
    await joinAsCustomer(owner.business.slug, program.id, { whatsappConsent: true });
    const campaign = await createCampaign(owner.client, bid);
    await owner.client.post(`/api/businesses/${bid}/campaigns/${campaign.id}/send`);
    await processOutbox(env, db());
    const [log] = await logsFor(campaign.id);
    const statusPayload = (status: string) => ({ entry: [{ changes: [{ value: { statuses: [{ id: log.provider_message_id, status }] } }] }] });

    expect((await postWebhook(statusPayload("read"), "sha256=deadbeef")).status).toBe(401);
    delete mutableEnv.WHATSAPP_APP_SECRET;
    expect((await postWebhook(statusPayload("read"))).status).toBe(401);
    configureWhatsApp();

    expect((await postWebhook(statusPayload("delivered"))).status).toBe(200);
    expect((await logsFor(campaign.id))[0].status).toBe("delivered");
    await postWebhook(statusPayload("read"));
    expect((await logsFor(campaign.id))[0].status).toBe("read");
    await postWebhook(statusPayload("delivered"));
    expect((await logsFor(campaign.id))[0].status).toBe("read");
  });

  it("treats STOP as withdrawal of WhatsApp consent", async () => {
    configureWhatsApp();
    const { owner, program } = await marketingSetup();
    const joined = await joinAsCustomer(owner.business.slug, program.id, { whatsappConsent: true });
    const res = await postWebhook({
      entry: [{ changes: [{ value: { messages: [{ from: `91${joined.phone}`, type: "text", text: { body: " STOP " } }] } }] }],
    });
    expect(res.status).toBe(200);
    const consent = await env.DB.prepare(
      "SELECT cs.status, cs.source FROM customer_consents cs JOIN customers c ON c.id = cs.customer_id WHERE c.phone = ? AND cs.channel = 'whatsapp'",
    )
      .bind(joined.phone)
      .first<{ status: string; source: string }>();
    expect(consent).toEqual({ status: "withdrawn", source: "whatsapp_stop" });
  });
});

describe("automations", () => {
  it("sends the birthday automation once per year", async () => {
    configureWhatsApp();
    const { owner, bid, program } = await marketingSetup();
    await joinAsCustomer(owner.business.slug, program.id, { whatsappConsent: true, birthday: istDateString().slice(5) });
    await joinAsCustomer(owner.business.slug, program.id, { whatsappConsent: false, birthday: istDateString().slice(5) });
    const campaign = await createCampaign(owner.client, bid, { name: "Birthday wishes", type: "birthday", mode: "automation", templateName: "bday_wish" });
    expect((await owner.client.post(`/api/businesses/${bid}/campaigns/${campaign.id}/activate`)).status).toBe(200);

    await runDailyAutomations(env, db());
    await runDailyAutomations(env, db());
    const logs = await logsFor(campaign.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].dedupe_key).toBe(`bday:${campaign.id}:${logs[0].customer_id}:${istDateString().slice(0, 4)}`);
  });

  it("does nothing for paused automations", async () => {
    configureWhatsApp();
    const { owner, bid, program } = await marketingSetup();
    await joinAsCustomer(owner.business.slug, program.id, { whatsappConsent: true, birthday: istDateString().slice(5) });
    const campaign = await createCampaign(owner.client, bid, { name: "Birthday wishes", type: "birthday", mode: "automation", templateName: "bday_wish" });
    await owner.client.post(`/api/businesses/${bid}/campaigns/${campaign.id}/activate`);
    expect((await owner.client.post(`/api/businesses/${bid}/campaigns/${campaign.id}/pause`)).status).toBe(200);
    await runDailyAutomations(env, db());
    expect(await logsFor(campaign.id)).toHaveLength(0);
  });

  it("enqueues the reward-unlocked automation when a card reaches a reward", async () => {
    configureWhatsApp();
    const { owner, bid, program } = await marketingSetup();
    const joined = await joinAsCustomer(owner.business.slug, program.id, { whatsappConsent: true });
    const campaign = await createCampaign(owner.client, bid, {
      name: "Reward ready",
      type: "reward_unlock",
      mode: "automation",
      templateName: "reward_ready",
      templateParams: ["{{name}}", "{{reward}}"],
    });
    await owner.client.post(`/api/businesses/${bid}/campaigns/${campaign.id}/activate`);

    await issueManual(owner.client, bid, joined.cardId);
    await issueManual(owner.client, bid, joined.cardId);
    let logs: any[] = [];
    for (let i = 0; i < 40 && logs.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
      logs = await logsFor(campaign.id);
    }
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].payload).bodyParams).toEqual(["Riya", "Free juice"]);
    expect(logs[0].status).toBe("queued");
  });
});

import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import { createDb } from "../db/client";
import { customers, marketingCampaigns, notificationLogs } from "../db/schema";
import { requireBusiness } from "../middleware/auth";
import { auditInsert } from "../lib/audit";
import { AppError, badRequest, notFound } from "../lib/errors";
import { validate } from "../lib/validation";
import { assertFeature, currentUsage, getPlanForBusiness } from "../services/plans";
import { audience } from "../services/segments";
import { startOneOffCampaign } from "../services/marketing-cron";
import { isWhatsAppConfigured, verifyWebhookSignature } from "../services/whatsapp";
import { CAMPAIGN_TYPES, CUSTOMER_SEGMENTS, type CampaignType } from "../../shared/domain";
import type { AppEnv } from "../types";

export const AUTOMATION_TYPES: CampaignType[] = ["birthday", "winback", "inactive", "reward_unlock", "progress"];
export const ONE_OFF_TYPES: CampaignType[] = ["occasion", "winback", "inactive"];
const LOG_PAGE = 50;

const baseFields = {
  name: z.string().trim().min(2).max(80),
  templateName: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,512}$/, "Use the exact approved template name (lowercase letters, numbers and underscores)"),
  templateLanguage: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Use a WhatsApp language code like en, hi, gu or en_US")
    .default("en"),
  templateParams: z.array(z.string().trim().max(200)).max(10).default([]),
  audience: z.object({ segment: z.enum(CUSTOMER_SEGMENTS).optional() }).default({}),
  settings: z.object({ inactiveDays: z.number().int().min(7).max(365).optional() }).default({}),
  scheduledAt: z.coerce.date().nullish(),
};

const createSchema = z
  .object({ ...baseFields, type: z.enum(CAMPAIGN_TYPES), mode: z.enum(["one_off", "automation"]) })
  .superRefine((v, ctx) => {
    const allowed = v.mode === "automation" ? AUTOMATION_TYPES : ONE_OFF_TYPES;
    if (!allowed.includes(v.type)) {
      ctx.addIssue({ code: "custom", path: ["type"], message: `"${v.type}" can't be used as a ${v.mode === "automation" ? "automation" : "one-off campaign"}` });
    }
    if (v.mode === "automation" && v.scheduledAt) ctx.addIssue({ code: "custom", path: ["scheduledAt"], message: "Automations run daily and can't be scheduled" });
  });

const updateSchema = z.object(baseFields).partial();

async function loadCampaign(c: Context<AppEnv>, id: string) {
  const campaign = await c
    .get("db")
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.businessId, c.get("membership").business.id)))
    .get();
  if (!campaign) throw notFound("Campaign");
  return campaign;
}

function requireWhatsApp(env: Env) {
  if (!isWhatsAppConfigured(env)) {
    throw new AppError(503, "WHATSAPP_NOT_CONFIGURED", "WhatsApp Business is not connected yet. Ask the platform admin to add the WhatsApp Cloud API credentials.");
  }
}

const manage = requireBusiness({ permission: "campaigns.manage" });

export const campaignRoutes = new Hono<AppEnv>()
  .get("/:businessId/marketing/status", manage, async (c) => {
    const db = c.get("db");
    const { business } = c.get("membership");
    const { plan } = await getPlanForBusiness(db, business.id);
    return c.json({
      whatsappConfigured: isWhatsAppConfigured(c.env),
      planAllows: plan.limits.marketing,
      planName: plan.name,
      monthlyLimit: plan.limits.marketing ? plan.limits.campaignMessagesPerMonth : 0,
      usedThisMonth: await currentUsage(db, "campaignMessagesPerMonth", { businessId: business.id }),
    });
  })

  .get("/:businessId/campaigns", manage, async (c) => {
    const db = c.get("db");
    const { business } = c.get("membership");
    const [list, counts] = await Promise.all([
      db.select().from(marketingCampaigns).where(eq(marketingCampaigns.businessId, business.id)).orderBy(desc(marketingCampaigns.createdAt)).all(),
      db
        .select({ campaignId: notificationLogs.campaignId, status: notificationLogs.status, n: count() })
        .from(notificationLogs)
        .where(eq(notificationLogs.businessId, business.id))
        .groupBy(notificationLogs.campaignId, notificationLogs.status)
        .all(),
    ]);
    return c.json({
      campaigns: list.map((cmp) => ({
        ...cmp,
        stats: Object.fromEntries(counts.filter((x) => x.campaignId === cmp.id).map((x) => [x.status, x.n])),
      })),
    });
  })

  .get("/:businessId/campaigns/audience-preview", manage, validate("query", z.object({ segment: z.enum(CUSTOMER_SEGMENTS).optional() })), async (c) => {
    const { segment } = c.req.valid("query");
    const rows = await audience(c.env.DB, c.get("membership").business.id, { segment });
    return c.json({ count: rows.length });
  })

  .post("/:businessId/campaigns", manage, validate("json", createSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.get("db");
    const { business } = c.get("membership");
    await assertFeature(db, business.id, "marketing");
    const id = crypto.randomUUID();
    await db.batch([
      db.insert(marketingCampaigns).values({ id, businessId: business.id, ...input, status: "draft", createdByUserId: c.get("user")!.id }),
      auditInsert(c, { businessId: business.id, action: "campaign.created", entityType: "campaign", entityId: id, metadata: { type: input.type, mode: input.mode } }),
    ]);
    return c.json({ campaign: await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id)).get() }, 201);
  })

  .patch("/:businessId/campaigns/:campaignId", manage, validate("json", updateSchema), async (c) => {
    const input = c.req.valid("json");
    if (Object.keys(input).length === 0) throw badRequest("Nothing to update");
    const db = c.get("db");
    const { business } = c.get("membership");
    await assertFeature(db, business.id, "marketing");
    const campaign = await loadCampaign(c, c.req.param("campaignId"));
    if (!["draft", "paused"].includes(campaign.status)) throw new AppError(409, "CAMPAIGN_LOCKED", "Only draft or paused campaigns can be edited");
    if (campaign.mode === "automation" && input.scheduledAt) throw badRequest("Automations run daily and can't be scheduled");
    await db.batch([
      db.update(marketingCampaigns).set(input).where(eq(marketingCampaigns.id, campaign.id)),
      auditInsert(c, { businessId: business.id, action: "campaign.updated", entityType: "campaign", entityId: campaign.id, metadata: { fields: Object.keys(input) } }),
    ]);
    return c.json({ campaign: await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, campaign.id)).get() });
  })

  .post("/:businessId/campaigns/:campaignId/:action{send|activate|pause|cancel}", manage, async (c) => {
    const db = c.get("db");
    const { business } = c.get("membership");
    const action = c.req.param("action") as "send" | "activate" | "pause" | "cancel";
    const campaign = await loadCampaign(c, c.req.param("campaignId"));
    const audit = (extra?: Record<string, unknown>) =>
      auditInsert(c, { businessId: business.id, action: `campaign.${action}`, entityType: "campaign", entityId: campaign.id, metadata: extra });

    if (action === "send") {
      if (campaign.mode !== "one_off") throw badRequest("Automations are activated, not sent");
      if (campaign.status !== "draft") throw new AppError(409, "CAMPAIGN_LOCKED", `This campaign is already ${campaign.status}`);
      await assertFeature(db, business.id, "marketing");
      requireWhatsApp(c.env);
      if (campaign.scheduledAt && campaign.scheduledAt.getTime() > Date.now()) {
        await db.batch([db.update(marketingCampaigns).set({ status: "scheduled" }).where(eq(marketingCampaigns.id, campaign.id)), audit({ scheduledAt: campaign.scheduledAt })]);
        return c.json({ status: "scheduled", queued: 0, skipped: 0 });
      }
      const result = await startOneOffCampaign(c.env, db, campaign, { id: business.id, name: business.name });
      await audit({ ...result });
      const fresh = await db.select({ status: marketingCampaigns.status }).from(marketingCampaigns).where(eq(marketingCampaigns.id, campaign.id)).get();
      return c.json({ status: fresh!.status, ...result });
    }

    if (action === "activate") {
      if (campaign.mode !== "automation") throw badRequest("Only automations can be activated");
      if (!["draft", "paused"].includes(campaign.status)) throw new AppError(409, "CAMPAIGN_LOCKED", `This automation is ${campaign.status}`);
      await assertFeature(db, business.id, "marketing");
      requireWhatsApp(c.env);
      await db.batch([db.update(marketingCampaigns).set({ status: "active", startedAt: campaign.startedAt ?? new Date() }).where(eq(marketingCampaigns.id, campaign.id)), audit()]);
      return c.json({ status: "active" });
    }

    if (action === "pause") {
      if (campaign.status !== "active") throw new AppError(409, "CAMPAIGN_LOCKED", "Only active automations can be paused");
      await db.batch([db.update(marketingCampaigns).set({ status: "paused" }).where(eq(marketingCampaigns.id, campaign.id)), audit()]);
      return c.json({ status: "paused" });
    }

    if (["completed", "cancelled", "failed"].includes(campaign.status)) throw new AppError(409, "CAMPAIGN_LOCKED", `This campaign is already ${campaign.status}`);
    await db.batch([
      db.update(marketingCampaigns).set({ status: "cancelled", completedAt: new Date() }).where(eq(marketingCampaigns.id, campaign.id)),
      db
        .update(notificationLogs)
        .set({ status: "skipped", error: "cancelled" })
        .where(and(eq(notificationLogs.campaignId, campaign.id), eq(notificationLogs.status, "queued"))),
      audit(),
    ]);
    return c.json({ status: "cancelled" });
  })

  .get(
    "/:businessId/campaigns/:campaignId/logs",
    manage,
    validate("query", z.object({ before: z.coerce.number().int().optional() })),
    async (c) => {
      const { before } = c.req.valid("query");
      const campaign = await loadCampaign(c, c.req.param("campaignId"));
      const rows = await c
        .get("db")
        .select({
          id: notificationLogs.id,
          status: notificationLogs.status,
          error: notificationLogs.error,
          attempts: notificationLogs.attempts,
          recipient: notificationLogs.recipient,
          createdAt: notificationLogs.createdAt,
          updatedAt: notificationLogs.updatedAt,
          customerName: customers.name,
        })
        .from(notificationLogs)
        .leftJoin(customers, eq(customers.id, notificationLogs.customerId))
        .where(and(eq(notificationLogs.campaignId, campaign.id), before ? lt(notificationLogs.createdAt, new Date(before)) : undefined))
        .orderBy(desc(notificationLogs.createdAt))
        .limit(LOG_PAGE + 1)
        .all();
      const page = rows.slice(0, LOG_PAGE);
      return c.json({ logs: page, nextBefore: rows.length > LOG_PAGE ? page.at(-1)!.createdAt.getTime() : null });
    },
  );

// ---------- WhatsApp Cloud API webhook ----------

/** Statuses a message may move from when WhatsApp reports `to`; prevents regressions such as read → delivered. */
const ALLOWED_FROM: Record<string, string[]> = {
  sent: ["queued", "sending"],
  delivered: ["queued", "sending", "sent"],
  read: ["queued", "sending", "sent", "delivered"],
  failed: ["queued", "sending", "sent"],
};

const STOP_WORDS = /^(stop|unsubscribe)$/i;

interface WebhookPayload {
  entry?: {
    changes?: {
      value?: {
        statuses?: { id?: string; status?: string; errors?: { code?: number; title?: string; message?: string }[] }[];
        messages?: { from?: string; type?: string; text?: { body?: string } }[];
      };
    }[];
  }[];
}

export const whatsappWebhookRoutes = new Hono<AppEnv>()
  .get("/", (c) => {
    const expected = c.env.WHATSAPP_VERIFY_TOKEN;
    if (expected && c.req.query("hub.mode") === "subscribe" && c.req.query("hub.verify_token") === expected) {
      return c.text(c.req.query("hub.challenge") ?? "");
    }
    return c.text("Forbidden", 403);
  })

  .post("/", async (c) => {
    const secret = c.env.WHATSAPP_APP_SECRET;
    const raw = await c.req.text();
    if (!secret || !(await verifyWebhookSignature(secret, raw, c.req.header("x-hub-signature-256")))) {
      return c.json({ error: { code: "INVALID_SIGNATURE", message: "Invalid signature" } }, 401);
    }
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ ok: true });
    }
    const db = createDb(c.env.DB);
    const now = new Date();
    const changes = (payload.entry ?? []).flatMap((e) => e.changes ?? []).map((ch) => ch.value ?? {});

    for (const status of changes.flatMap((v) => v.statuses ?? [])) {
      const from = status.status ? ALLOWED_FROM[status.status] : undefined;
      if (!status.id || !from) continue;
      const err = status.errors?.[0];
      await db
        .update(notificationLogs)
        .set({
          status: status.status as "sent" | "delivered" | "read" | "failed",
          ...(status.status === "failed" ? { error: `${err?.code ?? ""} ${err?.title ?? err?.message ?? "failed"}`.trim().slice(0, 300) } : {}),
        })
        .where(and(eq(notificationLogs.providerMessageId, status.id), inArray(notificationLogs.status, from as ("queued" | "sending" | "sent" | "delivered")[])));
    }

    for (const msg of changes.flatMap((v) => v.messages ?? [])) {
      if (msg.type !== "text" || !STOP_WORDS.test(msg.text?.body?.trim() ?? "")) continue;
      const digits = (msg.from ?? "").replace(/\D/g, "");
      const phone = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : null;
      if (!phone) continue;
      await c.env.DB.prepare(
        `UPDATE customer_consents SET status = 'withdrawn', withdrawn_at = ?1, updated_at = ?1, source = 'whatsapp_stop'
         WHERE channel = 'whatsapp' AND status = 'granted' AND customer_id IN (SELECT id FROM customers WHERE phone = ?2)`,
      )
        .bind(now.getTime(), phone)
        .run();
    }
    return c.json({ ok: true });
  });

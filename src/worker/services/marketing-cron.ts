import type { BatchItem } from "drizzle-orm/batch";
import { and, asc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { DB } from "../db/client";
import { businesses, customerConsents, customers, marketingCampaigns, notificationLogs, rewards } from "../db/schema";
import { AppError } from "../lib/errors";
import { currentUsage, getPlanForBusiness } from "./plans";
import { audience, type CustomerAggregate } from "./segments";
import { isWhatsAppConfigured, sendTemplate, WhatsAppSendError } from "./whatsapp";
import { istDateString, istDayStart } from "../../shared/domain";

const DAY = 86_400_000;
const FREQUENCY_CAP_MS = DAY;
const STUCK_SENDING_MS = 10 * 60_000;
const OUTBOX_BATCH = 50;
/** Delay before retry n (after the 1st, 2nd and 3rd failed attempt). A 4th failure is final. */
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;
const ACTIVE_STATUSES = ["queued", "sending", "sent", "delivered", "read"] as const;

export type Campaign = typeof marketingCampaigns.$inferSelect;

export interface Recipient {
  customerId: string;
  name: string;
  phone: string;
  points?: number;
  reward?: string | null;
  dedupeKey: string;
}

export function resolveParams(params: string[], vars: { name: string; business: string; points: string; reward: string }) {
  return params.map((p) => {
    const text = p.replace(/\{\{\s*(name|business|points|reward)\s*\}\}/gi, (_, k: string) => vars[k.toLowerCase() as keyof typeof vars]);
    // WhatsApp rejects empty template parameters.
    return text.trim() === "" ? "-" : text;
  });
}

async function lowestRewardName(db: DB, businessId: string) {
  const r = await db
    .select({ name: rewards.name })
    .from(rewards)
    .where(and(eq(rewards.businessId, businessId), eq(rewards.isActive, true)))
    .orderBy(asc(rewards.pointsRequired))
    .limit(1)
    .get();
  return r?.name ?? null;
}

/** Messages this business may still send this month; null = unlimited; 0 when the plan has no marketing. */
export async function remainingMessages(db: DB, businessId: string): Promise<number | null> {
  const { plan } = await getPlanForBusiness(db, businessId);
  if (!plan.limits.marketing) return 0;
  const limit = plan.limits.campaignMessagesPerMonth;
  if (limit === null) return null;
  const used = await currentUsage(db, "campaignMessagesPerMonth", { businessId });
  return Math.max(0, limit - used);
}

export function toRecipients(rows: CustomerAggregate[], key: (r: CustomerAggregate) => string): Recipient[] {
  return rows
    .filter((r) => r.phone)
    .map((r) => ({ customerId: r.customerId, name: r.name, phone: r.phone!, points: r.pointsBalance, dedupeKey: key(r) }));
}

export interface EnqueueResult {
  queued: number;
  skipped: number;
  dropped: number;
}

/**
 * Writes outbox rows. Callers must pass only recipients with granted consent (consent is re-checked at send time).
 * onLimit "throw" rejects the whole batch if it exceeds the monthly allowance; "truncate" sends as many as allowed.
 */
export async function enqueueMessages(
  db: DB,
  campaign: Campaign,
  business: { id: string; name: string },
  recipients: Recipient[],
  opts: { frequencyCap: boolean; onLimit: "throw" | "truncate" },
): Promise<EnqueueResult> {
  if (!recipients.length) return { queued: 0, skipped: 0, dropped: 0 };
  const now = Date.now();

  const capped = new Set<string>();
  if (opts.frequencyCap) {
    const recent = await db
      .selectDistinct({ customerId: notificationLogs.customerId })
      .from(notificationLogs)
      .where(
        and(
          eq(notificationLogs.businessId, business.id),
          inArray(notificationLogs.status, [...ACTIVE_STATUSES]),
          gte(notificationLogs.createdAt, new Date(now - FREQUENCY_CAP_MS)),
        ),
      )
      .all();
    for (const r of recent) if (r.customerId) capped.add(r.customerId);
  }

  let toSend = recipients.filter((r) => !capped.has(r.customerId));
  const toSkip = recipients.filter((r) => capped.has(r.customerId));
  const remaining = await remainingMessages(db, business.id);
  let dropped = 0;
  if (remaining !== null && toSend.length > remaining) {
    if (opts.onLimit === "throw") {
      throw new AppError(
        403,
        "PLAN_LIMIT_REACHED",
        `This campaign needs ${toSend.length} messages but only ${remaining} are left this month on your plan.`,
        { limit: "campaignMessagesPerMonth", remaining, needed: toSend.length },
      );
    }
    dropped = toSend.length - remaining;
    toSend = toSend.slice(0, remaining);
  }

  const defaultReward = recipients.some((r) => r.reward === undefined) ? await lowestRewardName(db, business.id) : null;
  const row = (r: Recipient, status: "queued" | "skipped") => ({
    id: crypto.randomUUID(),
    businessId: business.id,
    campaignId: campaign.id,
    customerId: r.customerId,
    channel: "whatsapp" as const,
    recipient: `91${r.phone}`,
    templateName: campaign.templateName,
    payload: {
      language: campaign.templateLanguage,
      bodyParams: resolveParams(campaign.templateParams, {
        name: r.name.split(" ")[0] || "Customer",
        business: business.name,
        points: String(r.points ?? 0),
        reward: r.reward ?? defaultReward ?? "your reward",
      }),
    },
    status,
    providerMessageId: null,
    error: status === "skipped" ? "frequency_cap" : null,
    attempts: 0,
    nextAttemptAt: null,
    dedupeKey: r.dedupeKey,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
  const rows = [...toSend.map((r) => row(r, "queued")), ...toSkip.map((r) => row(r, "skipped"))];

  // D1 allows 100 bound parameters per statement; each row binds 16.
  const statements: BatchItem<"sqlite">[] = [];
  for (let i = 0; i < rows.length; i += 6) {
    statements.push(db.insert(notificationLogs).values(rows.slice(i, i + 6)).onConflictDoNothing().returning({ status: notificationLogs.status }));
  }
  const results = (await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]])) as { status: string }[][];
  const inserted = results.flat();
  return {
    queued: inserted.filter((r) => r.status === "queued").length,
    skipped: inserted.filter((r) => r.status === "skipped").length,
    dropped,
  };
}

/** Enqueues a one-off campaign to its segment and marks it running (or completed when nobody is eligible). */
export async function startOneOffCampaign(env: Env, db: DB, campaign: Campaign, business: { id: string; name: string }) {
  const rows = await audience(env.DB, business.id, { segment: campaign.audience.segment as never });
  const recipients = toRecipients(rows, (r) => `camp:${campaign.id}:${r.customerId}`);
  const result = await enqueueMessages(db, campaign, business, recipients, { frequencyCap: true, onLimit: "throw" });
  const now = new Date();
  await db
    .update(marketingCampaigns)
    .set(result.queued > 0 ? { status: "running", startedAt: now } : { status: "completed", startedAt: now, completedAt: now })
    .where(eq(marketingCampaigns.id, campaign.id));
  return result;
}

async function startDueScheduledCampaigns(env: Env, db: DB) {
  const due = await db
    .select({ campaign: marketingCampaigns, businessName: businesses.name, businessStatus: businesses.status })
    .from(marketingCampaigns)
    .innerJoin(businesses, eq(businesses.id, marketingCampaigns.businessId))
    .where(and(eq(marketingCampaigns.status, "scheduled"), lte(marketingCampaigns.scheduledAt, new Date()), isNull(businesses.deletedAt)))
    .limit(10)
    .all();
  for (const { campaign, businessName, businessStatus } of due) {
    try {
      const remaining = await remainingMessages(db, campaign.businessId);
      if (businessStatus !== "active" || remaining === 0 || !isWhatsAppConfigured(env)) {
        await db.update(marketingCampaigns).set({ status: "failed" }).where(eq(marketingCampaigns.id, campaign.id));
        continue;
      }
      await startOneOffCampaign(env, db, campaign, { id: campaign.businessId, name: businessName });
    } catch (err) {
      console.error("scheduled campaign failed", campaign.id, err);
      await db.update(marketingCampaigns).set({ status: "failed" }).where(eq(marketingCampaigns.id, campaign.id));
    }
  }
}

async function completeFinishedCampaigns(env: Env) {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE marketing_campaigns SET status = 'completed', completed_at = ?1, updated_at = ?1
     WHERE status = 'running' AND NOT EXISTS (
       SELECT 1 FROM notification_logs n WHERE n.campaign_id = marketing_campaigns.id AND n.status IN ('queued', 'sending'))`,
  )
    .bind(now)
    .run();
}

/** Every minute: deliver queued messages from the notification outbox. */
export async function processOutbox(env: Env, db: DB): Promise<void> {
  await startDueScheduledCampaigns(env, db);
  const now = Date.now();

  // Rows left in "sending" by a crashed run go back to the queue.
  await db
    .update(notificationLogs)
    .set({ status: "queued" })
    .where(and(eq(notificationLogs.status, "sending"), lt(notificationLogs.updatedAt, new Date(now - STUCK_SENDING_MS))));

  const due = await db
    .select({ id: notificationLogs.id })
    .from(notificationLogs)
    .where(
      and(
        eq(notificationLogs.status, "queued"),
        or(isNull(notificationLogs.nextAttemptAt), lte(notificationLogs.nextAttemptAt, new Date(now))),
      ),
    )
    .orderBy(asc(notificationLogs.createdAt))
    .limit(OUTBOX_BATCH)
    .all();

  if (due.length) {
    // Conditional claim so overlapping cron runs never send the same row twice.
    const claimed = await db
      .update(notificationLogs)
      .set({ status: "sending" })
      .where(and(inArray(notificationLogs.id, due.map((d) => d.id)), eq(notificationLogs.status, "queued")))
      .returning();

    const customerIds = [...new Set(claimed.map((r) => r.customerId).filter((x): x is string => !!x))];
    const [people, consents] = customerIds.length
      ? await Promise.all([
          db.select({ id: customers.id, phone: customers.phone, deletedAt: customers.deletedAt }).from(customers).where(inArray(customers.id, customerIds)).all(),
          db
            .select({ businessId: customerConsents.businessId, customerId: customerConsents.customerId, status: customerConsents.status })
            .from(customerConsents)
            .where(and(inArray(customerConsents.customerId, customerIds), eq(customerConsents.channel, "whatsapp")))
            .all(),
        ])
      : [[], []];
    const personById = new Map(people.map((p) => [p.id, p]));
    const consentOf = (b: string, cu: string) => consents.find((x) => x.businessId === b && x.customerId === cu)?.status;
    const configured = isWhatsAppConfigured(env);

    const updates: BatchItem<"sqlite">[] = [];
    const set = (id: string, values: Partial<typeof notificationLogs.$inferInsert>) =>
      updates.push(db.update(notificationLogs).set(values).where(eq(notificationLogs.id, id)));

    for (let i = 0; i < claimed.length; i += 10) {
      await Promise.all(
        claimed.slice(i, i + 10).map(async (row) => {
          const person = row.customerId ? personById.get(row.customerId) : undefined;
          if (!person || person.deletedAt || !person.phone) return set(row.id, { status: "skipped", error: "customer_unavailable" });
          if (consentOf(row.businessId, person.id) !== "granted") return set(row.id, { status: "skipped", error: "consent_withdrawn" });
          if (!configured) return set(row.id, { status: "failed", error: "not_configured" });
          const attempts = row.attempts + 1;
          try {
            const payload = row.payload as { language: string; bodyParams: string[] };
            const providerMessageId = await sendTemplate(env, {
              to: row.recipient,
              templateName: row.templateName,
              language: payload.language,
              bodyParams: payload.bodyParams ?? [],
            });
            set(row.id, { status: "sent", providerMessageId, attempts, error: null, nextAttemptAt: null });
          } catch (err) {
            const e = err instanceof WhatsAppSendError ? err : new WhatsAppSendError(String(err), true);
            if (e.retryable && attempts < MAX_ATTEMPTS) {
              set(row.id, { status: "queued", attempts, error: e.message, nextAttemptAt: new Date(Date.now() + RETRY_BACKOFF_MS[attempts - 1]!) });
            } else {
              set(row.id, { status: "failed", attempts, error: e.message, nextAttemptAt: null });
            }
          }
        }),
      );
    }
    if (updates.length) await db.batch(updates as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  await completeFinishedCampaigns(env);
}

/** Daily (09:00 IST): enqueue birthday / win-back / inactive / progress automations. */
export async function runDailyAutomations(env: Env, db: DB): Promise<void> {
  if (!isWhatsAppConfigured(env)) {
    console.warn("WhatsApp not configured; skipping daily automations");
    return;
  }
  const now = Date.now();
  const today = istDateString(new Date(now));
  const todayStart = istDayStart(new Date(now)).getTime();

  const automations = await db
    .select({ campaign: marketingCampaigns, businessName: businesses.name })
    .from(marketingCampaigns)
    .innerJoin(businesses, eq(businesses.id, marketingCampaigns.businessId))
    .where(
      and(
        eq(marketingCampaigns.mode, "automation"),
        eq(marketingCampaigns.status, "active"),
        eq(businesses.status, "active"),
        isNull(businesses.deletedAt),
      ),
    )
    .all();

  for (const { campaign, businessName } of automations) {
    try {
      const { plan } = await getPlanForBusiness(db, campaign.businessId);
      if (!plan.limits.marketing) continue;
      const business = { id: campaign.businessId, name: businessName };
      let recipients: Recipient[] = [];

      if (campaign.type === "birthday") {
        const rows = await audience(env.DB, business.id, { where: "AND c.birthday = ?", whereParams: [today.slice(5)] }, now);
        recipients = toRecipients(rows, (r) => `bday:${campaign.id}:${r.customerId}:${today.slice(0, 4)}`);
      } else if (campaign.type === "winback" || campaign.type === "inactive") {
        const days = Number(campaign.settings.inactiveDays) || (campaign.type === "winback" ? 30 : 60);
        const from = todayStart - days * DAY;
        const rows = await audience(env.DB, business.id, { having: "lastVisitAt >= ? AND lastVisitAt < ?", havingParams: [from, from + DAY] }, now);
        recipients = toRecipients(rows, (r) => `${campaign.type}:${campaign.id}:${r.customerId}:${today}`);
      } else if (campaign.type === "progress") {
        const { results } = await env.DB.prepare(
          `SELECT cc.id AS cardId, c.id AS customerId, c.name AS name, c.phone AS phone, cc.points_balance AS points,
             (SELECT r.name FROM rewards r WHERE r.program_id = cc.program_id AND r.is_active = 1 ORDER BY r.points_required LIMIT 1) AS reward
           FROM customer_cards cc
           JOIN customers c ON c.id = cc.customer_id
           JOIN customer_consents cs ON cs.business_id = cc.business_id AND cs.customer_id = c.id AND cs.channel = 'whatsapp' AND cs.status = 'granted'
           WHERE cc.business_id = ?1 AND cc.status = 'active' AND c.phone IS NOT NULL AND c.deleted_at IS NULL
             AND cc.last_visit_at >= ?2 AND cc.last_visit_at < ?3
             AND cc.points_balance = (SELECT min(r.points_required) FROM rewards r WHERE r.program_id = cc.program_id AND r.is_active = 1) - 1`,
        )
          .bind(business.id, todayStart - DAY, todayStart)
          .all<{ cardId: string; customerId: string; name: string; phone: string; points: number; reward: string | null }>();
        recipients = results.map((r) => ({ ...r, dedupeKey: `progress:${campaign.id}:${r.cardId}:${today}` }));
      } else {
        continue; // reward_unlock is event-driven; occasion is one-off only
      }

      await enqueueMessages(db, campaign, business, recipients, { frequencyCap: true, onLimit: "truncate" });
    } catch (err) {
      console.error("automation failed", campaign.id, err);
    }
  }
}

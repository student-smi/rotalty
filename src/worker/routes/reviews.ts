import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, count, desc, eq, gte, isNull, sql, sum } from "drizzle-orm";
import type { DB } from "../db/client";
import { aiUsageLogs, businesses, googleReviewSettings, interactionEvents, reviewAssistantSessions, reviewDrafts, reviewKeywords } from "../db/schema";
import { requireBusiness } from "../middleware/auth";
import { auditInsert } from "../lib/audit";
import { AppError, badRequest, notFound } from "../lib/errors";
import { optionalText, validate } from "../lib/validation";
import { requireAnyPermission } from "../lib/scope";
import { assertTurnstile } from "../lib/turnstile";
import { assertWithinLimit, currentUsage, getPlanForBusiness } from "../services/plans";
import { eventInsert, recordEvent } from "../services/events";
import { AiError, aiProviderName, DRAFT_STYLES, generateReviewDrafts, KEYWORD_GROUPS, REVIEW_MOODS, suggestReviewKeywords, type ReviewPicks } from "../services/review-ai";
import { listKeywords, templateKeywords } from "../services/review-keywords";
import { placeProfile, placesEnabled, type PlaceProfile } from "../services/places";
import { logoUrl } from "./businesses";
import { istDayStart, REVIEW_LANGUAGES, type ReviewLanguage } from "../../shared/domain";
import type { AppEnv } from "../types";

const MAX_GENERATIONS_PER_SESSION = 3;
const AI_FEATURE = "review_drafts";

const GOOGLE_HOSTS = new Set(["google.com", "www.google.com", "maps.google.com", "search.google.com", "g.page", "maps.app.goo.gl", "goo.gl", "g.co"]);

export function isGoogleReviewUrl(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && GOOGLE_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    profileName: optionalText(120),
    reviewUrl: z
      .string()
      .trim()
      .max(500)
      .transform((v) => (v === "" ? null : v))
      .nullish()
      .refine((v) => !v || isGoogleReviewUrl(v), "Use an https link from Google Maps / Google Business Profile"),
    category: optionalText(80),
    description: optionalText(500),
    services: optionalText(500),
    languages: z.array(z.enum(REVIEW_LANGUAGES)).min(1, "Pick at least one language").transform((l) => [...new Set(l)]),
    showOnCard: z.boolean().optional(),
  })
  .refine((v) => !v.enabled || !!v.reviewUrl, { message: "Add your Google review link before enabling", path: ["reviewUrl"] });

const MAX_KEYWORDS = 15;
const MAX_PICKED_KEYWORDS = 4;
const MAX_SUGGESTIONS_PER_DAY = 10;
const KEYWORD_FEATURE = "review_keywords";

const keywordsSchema = z.object({
  keywords: z
    .array(z.object({ text: z.string().trim().min(2, "Keyword is too short").max(30, "Keep keywords under 30 characters"), group: z.enum(KEYWORD_GROUPS).default("other"), source: z.enum(["ai", "owner"]).default("owner") }))
    .max(MAX_KEYWORDS, `Up to ${MAX_KEYWORDS} keywords`),
});

const answer = (max = 500) => z.string().trim().max(max);

/** First three words of the last drafts, so new drafts avoid starting the same way. */
async function recentOpenings(db: DB, businessId: string): Promise<string[]> {
  const rows = await db
    .select({ text: reviewDrafts.text })
    .from(reviewDrafts)
    .where(eq(reviewDrafts.businessId, businessId))
    .orderBy(desc(reviewDrafts.createdAt))
    .limit(20)
    .all();
  return [...new Set(rows.map((r) => r.text.split(/\s+/).slice(0, 3).join(" ")).filter(Boolean))].slice(0, 12);
}

const draftsSchema = z
  .object({
    language: z.enum(REVIEW_LANGUAGES),
    answers: z
      .object({
        purchased: answer().min(1, "Tell us what you purchased"),
        overall: answer().min(1, "Tell us about your overall experience"),
        service: answer().optional().default(""),
        liked: answer().optional().default(""),
        extra: answer().optional().default(""),
      })
      .optional(),
    picks: z
      .object({
        mood: z.enum(REVIEW_MOODS),
        keywords: z.array(z.string().trim().min(1).max(30)).max(MAX_PICKED_KEYWORDS, `Pick up to ${MAX_PICKED_KEYWORDS} keywords`).default([]),
        note: answer(200).optional().default(""),
      })
      .optional(),
    sessionId: z.string().uuid().optional(),
  })
  .refine((v) => !!v.answers !== !!v.picks, { message: "Send either answers or picks" })
  .refine((v) => !v.picks || v.picks.keywords.length > 0 || !!v.picks.note, { message: "Pick at least one keyword", path: ["picks", "keywords"] });

export const normalizeKeyword = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

const DEFAULT_LANGUAGES: ReviewLanguage[] = ["en", "hi", "gu", "hinglish"];

function settingsView(s: typeof googleReviewSettings.$inferSelect | undefined) {
  return {
    enabled: s?.enabled ?? false,
    profileName: s?.profileName ?? null,
    reviewUrl: s?.reviewUrl ?? null,
    category: s?.category ?? null,
    description: s?.description ?? null,
    services: s?.services ?? null,
    languages: s?.languages ?? DEFAULT_LANGUAGES,
    showOnCard: s?.showOnCard ?? true,
  };
}

/** Business that has an active, enabled assistant with a review link; otherwise 404. */
async function activeAssistant(c: Context<AppEnv>, slug: string) {
  const row = await c
    .get("db")
    .select({ business: businesses, settings: googleReviewSettings })
    .from(businesses)
    .innerJoin(googleReviewSettings, eq(googleReviewSettings.businessId, businesses.id))
    .where(and(eq(businesses.slug, slug), isNull(businesses.deletedAt), eq(businesses.status, "active")))
    .get();
  if (!row || !row.settings.enabled || !row.settings.reviewUrl) throw notFound("Review assistant");
  return row as { business: typeof businesses.$inferSelect; settings: typeof googleReviewSettings.$inferSelect & { reviewUrl: string } };
}

const AI_MESSAGES: Record<string, { status: 429 | 502 | 503; message: string }> = {
  AI_UNAVAILABLE: { status: 503, message: "Review drafts aren't available right now. You can still write your own review." },
  AI_RATE_LIMITED: { status: 429, message: "The draft helper is busy. Please try again in a minute, or write your own review." },
  AI_ERROR: { status: 502, message: "We couldn't create drafts right now. Please try again, or write your own review." },
  AI_INVALID_RESPONSE: { status: 502, message: "We couldn't create good drafts this time. Please try again, or write your own review." },
};

export const reviewRoutes = new Hono<AppEnv>()
  .get("/:businessId/review-settings", requireBusiness({ permission: "reviews.manage" }), async (c) => {
    const { business } = c.get("membership");
    const s = await c.get("db").select().from(googleReviewSettings).where(eq(googleReviewSettings.businessId, business.id)).get();
    return c.json({ settings: settingsView(s), publicPath: `/s/${business.slug}/review` });
  })

  .put("/:businessId/review-settings", requireBusiness({ permission: "reviews.manage" }), validate("json", settingsSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.get("db");
    const { business } = c.get("membership");
    const values = { ...input, reviewUrl: input.reviewUrl ?? null };
    await db.batch([
      db
        .insert(googleReviewSettings)
        .values({ businessId: business.id, ...values })
        .onConflictDoUpdate({ target: googleReviewSettings.businessId, set: { ...values, updatedAt: new Date() } }),
      auditInsert(c, {
        businessId: business.id,
        action: "reviews.settings_updated",
        entityType: "google_review_settings",
        entityId: business.id,
        metadata: { enabled: input.enabled, languages: input.languages },
      }),
    ]);
    const s = await db.select().from(googleReviewSettings).where(eq(googleReviewSettings.businessId, business.id)).get();
    return c.json({ settings: settingsView(s), publicPath: `/s/${business.slug}/review` });
  })

  .get("/:businessId/review-keywords", requireBusiness({ permission: "reviews.manage" }), async (c) => {
    return c.json({ keywords: await listKeywords(c.get("db"), c.get("membership").business.id) });
  })

  .put("/:businessId/review-keywords", requireBusiness({ permission: "reviews.manage" }), validate("json", keywordsSchema), async (c) => {
    const db = c.get("db");
    const { business } = c.get("membership");
    const seen = new Set<string>();
    const rows = [];
    for (const k of c.req.valid("json").keywords) {
      const text = k.text.replace(/\s+/g, " ");
      const normalized = normalizeKeyword(text);
      if (seen.has(normalized)) continue;
      if (/(https?:|www\.|#)/i.test(text)) throw badRequest("Keywords can't contain links or hashtags", [{ path: "keywords", message: `Remove "${text}"` }]);
      seen.add(normalized);
      rows.push({ businessId: business.id, text, normalized, group: k.group, source: k.source, sortOrder: rows.length });
    }
    await db.batch([
      db.delete(reviewKeywords).where(eq(reviewKeywords.businessId, business.id)),
      ...(rows.length ? [db.insert(reviewKeywords).values(rows)] : []),
      auditInsert(c, { businessId: business.id, action: "reviews.keywords_updated", entityType: "review_keywords", entityId: business.id, metadata: { count: rows.length } }),
    ]);
    return c.json({ keywords: await listKeywords(db, business.id) });
  })

  /** AI keyword ideas from the business profile + Google listing facts. Not saved until the owner PUTs them. */
  .post("/:businessId/review-keywords/suggest", requireBusiness({ permission: "reviews.manage" }), async (c) => {
    const db = c.get("db");
    const { business } = c.get("membership");
    const today = await db
      .select({ n: count() })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.businessId, business.id), eq(aiUsageLogs.feature, KEYWORD_FEATURE), gte(aiUsageLogs.createdAt, istDayStart())))
      .get();
    if ((today?.n ?? 0) >= MAX_SUGGESTIONS_PER_DAY) {
      return c.json({ keywords: templateKeywords(business.category, business.city), source: "template" as const });
    }
    const settings = await db.select().from(googleReviewSettings).where(eq(googleReviewSettings.businessId, business.id)).get();

    let profile: PlaceProfile | null = null;
    if (business.googlePlaceId && placesEnabled(c.env)) {
      profile = await placeProfile(c.env, business.googlePlaceId).catch((err) => {
        console.error("Place profile failed", err);
        return null;
      });
    }

    try {
      await assertWithinLimit(db, "aiGenerationsPerMonth", { businessId: business.id });
      const result = await suggestReviewKeywords(c.env, {
        businessName: business.name,
        category: business.category,
        categoryLabel: profile?.categoryLabel ?? settings?.category,
        area: profile?.area,
        city: business.city,
        description: business.description ?? settings?.description,
        services: settings?.services,
        googleFacts: profile?.facts,
      });
      await db.insert(aiUsageLogs).values({
        businessId: business.id,
        provider: aiProviderName(c.env),
        model: result.meta.model,
        feature: KEYWORD_FEATURE,
        inputTokens: result.meta.inputTokens,
        outputTokens: result.meta.outputTokens,
        costMicroUsd: result.meta.costMicroUsd,
        status: "success",
        latencyMs: result.meta.latencyMs,
      });
      return c.json({ keywords: result.keywords, source: "ai" as const, usedGoogleFacts: !!profile?.facts.length });
    } catch (err) {
      if (err instanceof AiError) {
        await db.insert(aiUsageLogs).values({
          businessId: business.id,
          provider: aiProviderName(c.env),
          model: err.meta.model || "unknown",
          feature: KEYWORD_FEATURE,
          status: "error",
          errorCode: err.code,
          latencyMs: err.meta.latencyMs,
        });
      } else if (!(err instanceof AppError && err.code === "PLAN_LIMIT_REACHED")) throw err;
      // AI unavailable or quota used up: ready-made ideas for the category so onboarding never gets stuck.
      return c.json({ keywords: templateKeywords(business.category, profile?.area ?? business.city), source: "template" as const });
    }
  })

  .get(
    "/:businessId/review-analytics",
    requireBusiness(),
    validate("query", z.object({ days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30) })),
    async (c) => {
      requireAnyPermission(c, "reviews.manage", "analytics.view");
      const { days } = c.req.valid("query");
      const db = c.get("db");
      const { business } = c.get("membership");
      const since = new Date(Date.now() - days * 86400_000);

      const [events, sessionsByLang, drafts, usage] = await db.batch([
        db
          .select({ type: interactionEvents.type, n: count() })
          .from(interactionEvents)
          .where(and(eq(interactionEvents.businessId, business.id), gte(interactionEvents.createdAt, since), sql`${interactionEvents.type} like 'review_%'`))
          .groupBy(interactionEvents.type),
        db
          .select({
            language: reviewAssistantSessions.language,
            status: reviewAssistantSessions.status,
            n: count(),
            redirected: sql<number>`sum(case when ${reviewAssistantSessions.redirectedAt} is not null then 1 else 0 end)`,
          })
          .from(reviewAssistantSessions)
          .where(and(eq(reviewAssistantSessions.businessId, business.id), gte(reviewAssistantSessions.createdAt, since)))
          .groupBy(reviewAssistantSessions.language, reviewAssistantSessions.status),
        db
          .select({ n: count() })
          .from(reviewDrafts)
          .where(and(eq(reviewDrafts.businessId, business.id), gte(reviewDrafts.createdAt, since))),
        db
          .select({
            calls: count(),
            errors: sql<number>`sum(case when ${aiUsageLogs.status} = 'error' then 1 else 0 end)`,
            inputTokens: sum(aiUsageLogs.inputTokens),
            outputTokens: sum(aiUsageLogs.outputTokens),
            cost: sum(aiUsageLogs.costMicroUsd),
          })
          .from(aiUsageLogs)
          .where(and(eq(aiUsageLogs.businessId, business.id), eq(aiUsageLogs.feature, AI_FEATURE), gte(aiUsageLogs.createdAt, since))),
      ]);
      const ev = (t: string) => events.find((e) => e.type === t)?.n ?? 0;
      const languages: Record<string, number> = {};
      let generatedSessions = 0;
      let failedSessions = 0;
      for (const r of sessionsByLang) {
        languages[r.language] = (languages[r.language] ?? 0) + r.n;
        if (r.status === "generated") generatedSessions += r.n;
        else failedSessions += r.n;
      }
      const [{ plan }, usedThisMonth] = await Promise.all([
        getPlanForBusiness(db, business.id),
        currentUsage(db, "aiGenerationsPerMonth", { businessId: business.id }),
      ]);
      const u = usage[0];
      return c.json({
        days,
        visits: ev("review_visit"),
        sessionsGenerated: generatedSessions,
        sessionsFailed: failedSessions,
        generations: ev("review_generated"),
        failures: ev("review_failed"),
        draftsGenerated: drafts[0]?.n ?? 0,
        // Clicks on "Continue to Google Reviews" — NOT confirmed published reviews.
        redirectClicks: ev("review_redirect"),
        languages,
        ai: {
          calls: u?.calls ?? 0,
          errors: Number(u?.errors ?? 0),
          inputTokens: Number(u?.inputTokens ?? 0),
          outputTokens: Number(u?.outputTokens ?? 0),
          estimatedCostUsd: Number(u?.cost ?? 0) / 1_000_000,
        },
        monthly: { used: usedThisMonth, limit: plan.limits.aiGenerationsPerMonth, plan: plan.name },
      });
    },
  );

export const publicReviewRoutes = new Hono<AppEnv>()
  .post("/sessions/:id/redirect", async (c) => {
    const db = c.get("db");
    const row = await db
      .select({ session: reviewAssistantSessions, slug: businesses.slug })
      .from(reviewAssistantSessions)
      .innerJoin(businesses, eq(businesses.id, reviewAssistantSessions.businessId))
      .where(eq(reviewAssistantSessions.id, c.req.param("id")))
      .get();
    if (!row) throw notFound("Session");
    const { business, settings } = await activeAssistant(c, row.slug);
    const body = (await c.req.json().catch(() => null)) as { style?: unknown } | null;
    const style = DRAFT_STYLES.find((s) => s === body?.style);
    await db.batch([
      db
        .update(reviewAssistantSessions)
        .set({ redirectedAt: new Date() })
        .where(and(eq(reviewAssistantSessions.id, row.session.id), isNull(reviewAssistantSessions.redirectedAt))),
      eventInsert(db, { businessId: business.id, type: "review_redirect", metadata: { sessionId: row.session.id, ...(style ? { style } : {}) } }),
    ]);
    return c.json({ url: settings.reviewUrl });
  })

  .get("/:slug", async (c) => {
    const { business, settings } = await activeAssistant(c, c.req.param("slug"));
    const db = c.get("db");
    const [keywords] = await Promise.all([listKeywords(db, business.id), recordEvent(db, { businessId: business.id, type: "review_visit" })]);
    return c.json({
      business: { name: business.name, slug: business.slug, category: business.category, logoUrl: logoUrl(business.logoKey) },
      profileName: settings.profileName ?? business.name,
      languages: settings.languages,
      keywords: keywords.map((k) => ({ text: k.text, group: k.group })),
    });
  })

  /** "Write my own review" path — tracks the click even when no drafts were generated. */
  .post("/:slug/redirect", async (c) => {
    const { business, settings } = await activeAssistant(c, c.req.param("slug"));
    await recordEvent(c.get("db"), { businessId: business.id, type: "review_redirect", metadata: { withoutDrafts: true } });
    return c.json({ url: settings.reviewUrl });
  })

  .post("/:slug/drafts", validate("json", draftsSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.get("db");
    const { business, settings } = await activeAssistant(c, c.req.param("slug"));
    if (!settings.languages.includes(input.language)) throw badRequest("This language isn't available for this business");

    let existing: typeof reviewAssistantSessions.$inferSelect | undefined;
    if (input.sessionId) {
      existing = await db
        .select()
        .from(reviewAssistantSessions)
        .where(and(eq(reviewAssistantSessions.id, input.sessionId), eq(reviewAssistantSessions.businessId, business.id)))
        .get();
      if (!existing) throw notFound("Session");
      if (existing.generationCount >= MAX_GENERATIONS_PER_SESSION) {
        throw new AppError(429, "REGENERATE_LIMIT", "You've reached the limit for new drafts. Edit one of the drafts below, or write your own.");
      }
    }

    // Quick flow: keywords must come from the owner's list (canonical spelling); the free-text note is the customer's own.
    let picks: ReviewPicks | undefined;
    let avoidOpenings: string[] | undefined;
    if (input.picks) {
      const allowed = new Map((await listKeywords(db, business.id)).map((k) => [normalizeKeyword(k.text), k.text]));
      const keywords = [...new Set(input.picks.keywords.map(normalizeKeyword))].map((k) => allowed.get(k));
      if (keywords.some((k) => !k)) throw badRequest("Pick keywords from the list", [{ path: "picks.keywords", message: "Unknown keyword" }]);
      picks = { mood: input.picks.mood, keywords: keywords as string[], note: input.picks.note };
      avoidOpenings = await recentOpenings(db, business.id);
    }

    await assertTurnstile(c);
    await assertWithinLimit(db, "aiGenerationsPerMonth", { businessId: business.id });

    const sessionId = existing?.id ?? crypto.randomUUID();
    const answers: Record<string, string> = input.answers ?? { mood: picks!.mood, keywords: picks!.keywords.join(" | "), note: picks!.note ?? "" };
    const now = new Date();
    const provider = aiProviderName(c.env);

    try {
      const result = await generateReviewDrafts(c.env, {
        businessName: settings.profileName || business.name,
        category: settings.category ?? business.category,
        city: business.city,
        description: settings.description ?? business.description,
        services: settings.services,
        language: input.language,
        answers: input.answers,
        picks,
        avoidOpenings,
      });
      await db.batch([
        existing
          ? db
              .update(reviewAssistantSessions)
              .set({ language: input.language, answers, status: "generated", errorCode: null, generationCount: sql`${reviewAssistantSessions.generationCount} + 1` })
              .where(eq(reviewAssistantSessions.id, sessionId))
          : db.insert(reviewAssistantSessions).values({ id: sessionId, businessId: business.id, language: input.language, answers, status: "generated" }),
        db.insert(reviewDrafts).values(result.drafts.map((d) => ({ sessionId, businessId: business.id, style: d.style, text: d.text }))),
        db.insert(aiUsageLogs).values({
          businessId: business.id,
          provider,
          model: result.model,
          feature: AI_FEATURE,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costMicroUsd: result.costMicroUsd,
          status: "success",
          latencyMs: result.latencyMs,
        }),
        eventInsert(db, { businessId: business.id, type: "review_generated", metadata: { language: input.language, sessionId } }),
      ]);
      return c.json({ sessionId, drafts: result.drafts, generationsLeft: MAX_GENERATIONS_PER_SESSION - ((existing?.generationCount ?? 0) + 1) });
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      const info = AI_MESSAGES[err.code]!;
      if (err.code !== "AI_UNAVAILABLE") {
        await db.batch([
          existing
            ? db.update(reviewAssistantSessions).set({ errorCode: err.code, updatedAt: now }).where(eq(reviewAssistantSessions.id, sessionId))
            : db
                .insert(reviewAssistantSessions)
                .values({ id: sessionId, businessId: business.id, language: input.language, answers, status: "failed", errorCode: err.code, generationCount: 0 }),
          db.insert(aiUsageLogs).values({
            businessId: business.id,
            provider,
            model: err.meta.model,
            feature: AI_FEATURE,
            inputTokens: err.meta.inputTokens ?? 0,
            outputTokens: err.meta.outputTokens ?? 0,
            costMicroUsd: 0,
            status: "error",
            errorCode: err.code,
            latencyMs: err.meta.latencyMs,
          }),
          eventInsert(db, { businessId: business.id, type: "review_failed", reason: err.code }),
        ]);
      }
      throw new AppError(info.status, err.code, info.message, { sessionId: err.code === "AI_UNAVAILABLE" ? null : sessionId });
    }
  });

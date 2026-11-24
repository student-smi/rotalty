import { Hono } from "hono";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { createDb } from "../db/client";
import { businesses, customerCards, googleReviewSettings, interactionEvents, loyaltyPrograms, media, nfcTags, qrCodes, rewards, subscriptionPlans, supportMessages } from "../db/schema";
import { shopLinks } from "../../shared/shop-links";
import { z } from "zod";
import { validate } from "../lib/validation";
import { assertTurnstile } from "../lib/turnstile";
import { notFound } from "../lib/errors";
import { eventInsert } from "../services/events";
import { isProgramLive } from "../services/loyalty-engine";
import { logoUrl } from "./businesses";
import type { AppEnv } from "../types";

const supportSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  contact: z
    .string()
    .trim()
    .max(120)
    .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || /^(\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/.test(v), "Enter an email or a 10-digit mobile number"),
  topic: z.enum(["shop_owner", "customer", "privacy", "other"]),
  businessName: z.string().trim().max(120).optional(),
  message: z.string().trim().min(10, "Tell us a little more (at least 10 characters)").max(2000),
});

const LINK_KINDS = ["whatsapp", "instagram", "directions", "call", "website"] as const;

export const publicApiRoutes = new Hono<AppEnv>()
  /** Counts taps on the shop's contact buttons (shown to the owner in Analytics). */
  .post("/b/:slug/link", validate("json", z.object({ kind: z.enum(LINK_KINDS) })), async (c) => {
    const biz = await c
      .get("db")
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.slug, c.req.param("slug")), isNull(businesses.deletedAt)))
      .get();
    if (!biz) throw notFound("Business");
    await c.get("db").insert(interactionEvents).values({ businessId: biz.id, type: "shop_link_click", channel: c.req.valid("json").kind, customerId: c.get("customer")?.id ?? null });
    return c.json({ ok: true });
  })

  /** Contact form on /support. Stored for Super Admins; nothing is emailed. */
  .post("/support", validate("json", supportSchema), async (c) => {
    await assertTurnstile(c);
    const input = c.req.valid("json");
    await c.get("db").insert(supportMessages).values({ ...input, businessName: input.businessName || null });
    return c.json({ ok: true }, 201);
  })

  /** Active plans for the marketing site's pricing section. */
  .get("/plans", async (c) => {
    const plans = await c
      .get("db")
      .select({
        code: subscriptionPlans.code,
        name: subscriptionPlans.name,
        description: subscriptionPlans.description,
        pricePaise: subscriptionPlans.pricePaise,
        intervalDays: subscriptionPlans.intervalDays,
        limits: subscriptionPlans.limits,
      })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true))
      .orderBy(asc(subscriptionPlans.sortOrder))
      .all();
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ plans });
  })

  .get("/b/:slug", async (c) => {
    const db = c.get("db");
    const customer = c.get("customer");
    // Everything is looked up by slug, so the whole page is ONE database round-trip (was four in a row).
    const shop = and(eq(businesses.slug, c.req.param("slug")), isNull(businesses.deletedAt), eq(businesses.status, "active"));
    const [bizRows, programRows, reviewRows, rewardRows, cardRows] = await db.batch([
      db.select().from(businesses).where(shop).limit(1),
      db
        .select({ p: loyaltyPrograms })
        .from(loyaltyPrograms)
        .innerJoin(businesses, eq(businesses.id, loyaltyPrograms.businessId))
        .where(and(shop, isNull(loyaltyPrograms.deletedAt), eq(loyaltyPrograms.status, "active")))
        .orderBy(asc(loyaltyPrograms.createdAt)),
      db.select({ r: googleReviewSettings }).from(googleReviewSettings).innerJoin(businesses, eq(businesses.id, googleReviewSettings.businessId)).where(shop).limit(1),
      db
        .select({ r: rewards })
        .from(rewards)
        .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, rewards.programId))
        .innerJoin(businesses, eq(businesses.id, loyaltyPrograms.businessId))
        .where(and(shop, eq(rewards.isActive, true), isNull(loyaltyPrograms.deletedAt)))
        .orderBy(asc(rewards.pointsRequired)),
      db
        .select({ id: customerCards.id, programId: customerCards.programId, pointsBalance: customerCards.pointsBalance })
        .from(customerCards)
        .innerJoin(businesses, eq(businesses.id, customerCards.businessId))
        .where(and(shop, eq(customerCards.customerId, customer?.id ?? "-"))),
    ]);
    const biz = bizRows[0];
    if (!biz) throw notFound("Business");
    const live = programRows.map((x) => x.p).filter((p) => isProgramLive(p));
    const liveIds = new Set(live.map((p) => p.id));
    const rs = rewardRows.map((x) => x.r).filter((r) => liveIds.has(r.programId));
    const review = reviewRows[0]?.r;
    const myCards = customer ? cardRows : [];

    return c.json({
      business: {
        id: biz.id,
        name: biz.name,
        slug: biz.slug,
        category: biz.category,
        description: biz.description,
        city: biz.city,
        addressLine: biz.addressLine,
        phone: biz.phone,
        logoUrl: logoUrl(biz.logoKey),
        links: shopLinks(biz),
      },
      channels: { qr: biz.qrEnabled, nfcTag: biz.nfcTagEnabled },
      programs: live.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        stampIcon: p.stampIcon,
        stampsRequired: p.stampsRequired,
        minPurchaseAmount: p.minPurchaseAmount,
        endsAt: p.endsAt,
        eligibility: p.eligibility,
        terms: p.terms,
        rewards: rs.filter((r) => r.programId === p.id).map((r) => ({ id: r.id, name: r.name, description: r.description, pointsRequired: r.pointsRequired })),
      })),
      // Reviews are offered to every visitor; they are never tied to loyalty or filtered by sentiment.
      reviewAssistant: Boolean(review?.enabled && review.reviewUrl),
      customer: customer ? { name: customer.name } : null,
      myCards,
    });
  })

  .get("/media/:id", async (c) => {
    const row = await c.get("db").select().from(media).where(eq(media.id, c.req.param("id"))).get();
    if (!row) throw notFound("File");
    return new Response(row.data, {
      headers: {
        "Content-Type": row.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  });

/** Printed QR (/q/:code) and NFC tag (/t/:code) entry points. They only open the business page; they never issue points. */
export const shortLinkRoutes = new Hono<AppEnv>()
  .get("/q/:code", async (c) => {
    const db = createDb(c.env.DB);
    const row = await db
      .select({ qr: qrCodes, slug: businesses.slug })
      .from(qrCodes)
      .innerJoin(businesses, eq(businesses.id, qrCodes.businessId))
      .where(eq(qrCodes.code, c.req.param("code")))
      .get();
    if (!row) return c.redirect("/link-invalid", 302);
    if (row.qr.status !== "active") return c.redirect(`/s/${row.slug}?link=expired`, 302);
    c.executionCtx.waitUntil(
      db
        .batch([
          db
            .update(qrCodes)
            .set({ scanCount: sql`${qrCodes.scanCount} + 1`, lastScannedAt: new Date() })
            .where(eq(qrCodes.id, row.qr.id)),
          eventInsert(db, { businessId: row.qr.businessId, type: "qr_scan", channel: "qr", metadata: { qrId: row.qr.id } }),
        ])
        .catch((e) => console.error("qr scan log failed", e)),
    );
    return c.redirect(`/s/${row.slug}?via=qr`, 302);
  })

  .get("/t/:code", async (c) => {
    const db = createDb(c.env.DB);
    const row = await db
      .select({ tag: nfcTags, slug: businesses.slug, nfcEnabled: businesses.nfcTagEnabled })
      .from(nfcTags)
      .innerJoin(businesses, eq(businesses.id, nfcTags.businessId))
      .where(eq(nfcTags.code, c.req.param("code")))
      .get();
    if (!row) return c.redirect("/link-invalid", 302);
    c.executionCtx.waitUntil(
      db
        .batch([
          db
            .update(nfcTags)
            .set({ tapCount: sql`${nfcTags.tapCount} + 1`, lastTapAt: new Date() })
            .where(eq(nfcTags.id, row.tag.id)),
          eventInsert(db, {
            businessId: row.tag.businessId,
            type: "nfc_tap",
            channel: "nfc_tag",
            outcome: row.tag.status === "active" && row.nfcEnabled ? "ok" : "rejected",
            metadata: { tagId: row.tag.id },
          }),
        ])
        .catch((e) => console.error("nfc tap log failed", e)),
    );
    if (row.tag.status !== "active" || !row.nfcEnabled) return c.redirect(`/s/${row.slug}?link=expired`, 302);
    return c.redirect(`/s/${row.slug}?tag=${row.tag.code}`, 302);
  });

import { Hono } from "hono";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { createDb } from "../db/client";
import { businesses, customerCards, googleReviewSettings, loyaltyPrograms, media, nfcTags, qrCodes, rewards, subscriptionPlans } from "../db/schema";
import { notFound } from "../lib/errors";
import { eventInsert } from "../services/events";
import { isProgramLive } from "../services/loyalty-engine";
import { logoUrl } from "./businesses";
import type { AppEnv } from "../types";

export const publicApiRoutes = new Hono<AppEnv>()
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
    const biz = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.slug, c.req.param("slug")), isNull(businesses.deletedAt), eq(businesses.status, "active")))
      .get();
    if (!biz) throw notFound("Business");

    const [programs, review] = await Promise.all([
      db
        .select()
        .from(loyaltyPrograms)
        .where(and(eq(loyaltyPrograms.businessId, biz.id), isNull(loyaltyPrograms.deletedAt), eq(loyaltyPrograms.status, "active")))
        .orderBy(asc(loyaltyPrograms.createdAt))
        .all(),
      db.select().from(googleReviewSettings).where(eq(googleReviewSettings.businessId, biz.id)).get(),
    ]);
    const live = programs.filter((p) => isProgramLive(p));
    const rs = live.length
      ? await db
          .select()
          .from(rewards)
          .where(and(inArray(rewards.programId, live.map((p) => p.id)), eq(rewards.isActive, true)))
          .orderBy(asc(rewards.pointsRequired))
          .all()
      : [];

    const customer = c.get("customer");
    const myCards = customer
      ? await db
          .select({ id: customerCards.id, programId: customerCards.programId, pointsBalance: customerCards.pointsBalance })
          .from(customerCards)
          .where(and(eq(customerCards.businessId, biz.id), eq(customerCards.customerId, customer.id)))
          .all()
      : [];

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

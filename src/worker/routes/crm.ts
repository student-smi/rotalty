import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { customerCards, customerConsents, loyaltyPrograms, rewardRedemptions, rewards, stampTransactions, users } from "../db/schema";
import { requireBusiness } from "../middleware/auth";
import { auditInsert } from "../lib/audit";
import { notFound } from "../lib/errors";
import { validate } from "../lib/validation";
import { customerAggregate, listCustomers, segmentStats, segmentsFor, type CustomerAggregate } from "../services/segments";
import { CONSENT_CHANNELS, CUSTOMER_SEGMENTS, istDateString } from "../../shared/domain";
import type { AppEnv } from "../types";

const PAGE_SIZE = 25;
const EXPORT_MAX = 50_000;

const iso = (ms: number | null) => (ms === null || ms === undefined ? null : new Date(Number(ms)).toISOString());

function customerView(r: CustomerAggregate, now = Date.now()) {
  const deleted = r.deletedAt !== null && r.deletedAt !== undefined;
  return {
    id: r.customerId,
    name: deleted ? "Deleted customer" : r.name,
    phone: deleted ? null : r.phone,
    email: deleted ? null : r.email,
    birthday: deleted ? null : r.birthday,
    deleted,
    cards: r.cards,
    visits: r.visits,
    pointsBalance: r.pointsBalance,
    lifetimePoints: r.lifetimePoints,
    rewardsRedeemed: r.rewardsRedeemed,
    lastVisitAt: iso(r.lastVisitAt),
    joinedAt: iso(r.joinedAt),
    segments: segmentsFor(r, now),
    whatsappOptIn: !deleted && r.whatsappConsent === "granted",
  };
}

/** Quotes a CSV cell and defuses spreadsheet formula injection. */
export function csvCell(value: unknown) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  segment: z.enum(CUSTOMER_SEGMENTS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const crmRoutes = new Hono<AppEnv>()
  .get("/:businessId/customers/stats", requireBusiness({ permission: "customers.view" }), async (c) => {
    return c.json({ stats: await segmentStats(c.env.DB, c.get("membership").business.id) });
  })

  .get("/:businessId/customers/export", requireBusiness({ permission: "customers.export" }), validate("query", listQuery.omit({ page: true })), async (c) => {
    const { q, segment } = c.req.valid("query");
    const { business } = c.get("membership");
    const now = Date.now();
    const rows = await listCustomers(c.env.DB, business.id, { q, segment, limit: EXPORT_MAX, offset: 0 }, now);
    const header = ["Name", "Phone", "Email", "Birthday (MM-DD)", "Joined", "Last visit", "Visits", "Points balance", "Lifetime points", "Rewards redeemed", "Segments", "WhatsApp opt-in"];
    const lines = rows.map((r) => {
      const v = customerView(r, now);
      return [v.name, v.phone, v.email, v.birthday, v.joinedAt, v.lastVisitAt, v.visits, v.pointsBalance, v.lifetimePoints, v.rewardsRedeemed, v.segments.join(" "), v.whatsappOptIn ? "yes" : "no"]
        .map(csvCell)
        .join(",");
    });
    await auditInsert(c, {
      businessId: business.id,
      action: "customers.exported",
      entityType: "customer",
      metadata: { count: rows.length, q: q ?? null, segment: segment ?? null },
    });
    const csv = "﻿" + [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="customers-${business.slug}-${istDateString()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  })

  .get("/:businessId/customers", requireBusiness({ permission: "customers.view" }), validate("query", listQuery), async (c) => {
    const { q, segment, page } = c.req.valid("query");
    const now = Date.now();
    const rows = await listCustomers(
      c.env.DB,
      c.get("membership").business.id,
      { q, segment, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE },
      now,
    );
    return c.json({ customers: rows.slice(0, PAGE_SIZE).map((r) => customerView(r, now)), page, hasMore: rows.length > PAGE_SIZE });
  })

  .get("/:businessId/customers/:customerId", requireBusiness({ permission: "customers.view" }), async (c) => {
    const db = c.get("db");
    const { business } = c.get("membership");
    const customerId = c.req.param("customerId");
    const agg = await customerAggregate(c.env.DB, business.id, customerId);
    if (!agg) throw notFound("Customer");

    const [cards, history, redemptions, consents] = await Promise.all([
      db
        .select({ card: customerCards, programName: loyaltyPrograms.name, stampsRequired: loyaltyPrograms.stampsRequired, stampIcon: loyaltyPrograms.stampIcon })
        .from(customerCards)
        .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, customerCards.programId))
        .where(and(eq(customerCards.businessId, business.id), eq(customerCards.customerId, customerId)))
        .all(),
      db
        .select({
          id: stampTransactions.id,
          type: stampTransactions.type,
          points: stampTransactions.points,
          channel: stampTransactions.channel,
          createdAt: stampTransactions.createdAt,
          programName: loyaltyPrograms.name,
          staffName: users.name,
        })
        .from(stampTransactions)
        .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, stampTransactions.programId))
        .leftJoin(users, eq(users.id, stampTransactions.actorUserId))
        .where(and(eq(stampTransactions.businessId, business.id), eq(stampTransactions.customerId, customerId)))
        .orderBy(desc(stampTransactions.createdAt))
        .limit(50)
        .all(),
      db
        .select({ id: rewardRedemptions.id, rewardName: rewardRedemptions.rewardName, pointsUsed: rewardRedemptions.pointsUsed, createdAt: rewardRedemptions.createdAt })
        .from(rewardRedemptions)
        .where(and(eq(rewardRedemptions.businessId, business.id), eq(rewardRedemptions.customerId, customerId)))
        .orderBy(desc(rewardRedemptions.createdAt))
        .limit(20)
        .all(),
      db
        .select({ channel: customerConsents.channel, status: customerConsents.status, source: customerConsents.source, grantedAt: customerConsents.grantedAt, withdrawnAt: customerConsents.withdrawnAt })
        .from(customerConsents)
        .where(and(eq(customerConsents.businessId, business.id), eq(customerConsents.customerId, customerId)))
        .all(),
    ]);

    const programIds = [...new Set(cards.map((x) => x.card.programId))];
    const rewardRows = programIds.length
      ? await db.select({ programId: rewards.programId, name: rewards.name, pointsRequired: rewards.pointsRequired, isActive: rewards.isActive }).from(rewards).where(eq(rewards.businessId, business.id)).all()
      : [];

    return c.json({
      customer: customerView(agg),
      cards: cards.map(({ card, programName, stampsRequired, stampIcon }) => ({
        id: card.id,
        status: card.status,
        programId: card.programId,
        programName,
        stampsRequired,
        stampIcon,
        pointsBalance: card.pointsBalance,
        lifetimePoints: card.lifetimePoints,
        visits: card.visits,
        rewardsRedeemed: card.rewardsRedeemed,
        lastVisitAt: card.lastVisitAt,
        joinedAt: card.createdAt,
        rewards: rewardRows
          .filter((r) => r.programId === card.programId && r.isActive)
          .sort((a, b) => a.pointsRequired - b.pointsRequired)
          .map((r) => ({ name: r.name, pointsRequired: r.pointsRequired })),
      })),
      history,
      redemptions,
      consents: CONSENT_CHANNELS.map((channel) => consents.find((x) => x.channel === channel) ?? { channel, status: null, source: null, grantedAt: null, withdrawnAt: null }),
    });
  })

  .patch(
    "/:businessId/cards/:cardId",
    requireBusiness({ permission: "loyalty.manage" }),
    validate("json", z.object({ status: z.enum(["active", "blocked"]) })),
    async (c) => {
      const { status } = c.req.valid("json");
      const db = c.get("db");
      const { business } = c.get("membership");
      const scope = and(eq(customerCards.id, c.req.param("cardId")), eq(customerCards.businessId, business.id));
      const card = await db.select({ id: customerCards.id }).from(customerCards).where(scope).get();
      if (!card) throw notFound("Card");
      await db.batch([
        db.update(customerCards).set({ status }).where(scope),
        auditInsert(c, { businessId: business.id, action: status === "blocked" ? "card.blocked" : "card.unblocked", entityType: "card", entityId: card.id }),
      ]);
      return c.json({ ok: true });
    },
  )

  /** Businesses can only record a withdrawal the customer asked for; they can never grant consent for a customer. */
  .put(
    "/:businessId/customers/:customerId/consents/:channel{whatsapp|sms|email}",
    requireBusiness({ permission: "customers.view" }),
    validate("json", z.object({ action: z.literal("withdraw") })),
    async (c) => {
      const db = c.get("db");
      const { business } = c.get("membership");
      const customerId = c.req.param("customerId");
      const channel = c.req.param("channel") as (typeof CONSENT_CHANNELS)[number];
      const hasCard = await db
        .select({ id: customerCards.id })
        .from(customerCards)
        .where(and(eq(customerCards.businessId, business.id), eq(customerCards.customerId, customerId)))
        .get();
      if (!hasCard) throw notFound("Customer");
      const now = new Date();
      await db.batch([
        db
          .insert(customerConsents)
          .values({ businessId: business.id, customerId, channel, status: "withdrawn", source: "business_on_request", withdrawnAt: now })
          .onConflictDoUpdate({
            target: [customerConsents.businessId, customerConsents.customerId, customerConsents.channel],
            set: { status: "withdrawn", source: "business_on_request", withdrawnAt: now, updatedAt: now },
          }),
        auditInsert(c, { businessId: business.id, action: "consent.withdrawn_by_business", entityType: "customer", entityId: customerId, metadata: { channel } }),
      ]);
      return c.json({ ok: true });
    },
  );

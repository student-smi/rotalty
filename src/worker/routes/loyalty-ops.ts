import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import {
  customerCards,
  customers,
  loyaltyPrograms,
  nfcSessions,
  nfcTags,
  rewardRedemptions,
  rewards,
  stampTransactions,
  users,
} from "../db/schema";
import { requireBusiness } from "../middleware/auth";
import { AppError, notFound } from "../lib/errors";
import { indianPhone, validate } from "../lib/validation";
import { requireAnyPermission, resolveLocation } from "../lib/scope";
import { EngineError, issuePoint, redeemReward, type IssueResult } from "../services/loyalty-engine";
import { verifyAnyCardCode } from "../services/card-token";
import { queueWalletSync } from "../services/google-wallet";
import { recordEvent } from "../services/events";
import { onRewardUnlocked } from "../services/automations";
import { ISSUE_CHANNELS, type IssueChannel } from "../../shared/domain";
import type { AppEnv } from "../types";

const idempotencyKey = z.string().trim().min(8).max(100);
const PAGE_SIZE = 50;

async function afterIssue(c: Context<AppEnv>, result: IssueResult, channel: IssueChannel) {
  const db = c.get("db");
  const businessId = c.get("membership").business.id;
  queueWalletSync(c, result.cardId);
  await recordEvent(db, {
    businessId,
    type: "issue_success",
    channel,
    outcome: "success",
    customerId: result.customer.id,
    cardId: result.cardId,
    actorUserId: c.get("user")?.id,
  });
  for (const reward of result.unlockedRewards) {
    await recordEvent(db, {
      businessId,
      type: "reward_unlocked",
      channel,
      customerId: result.customer.id,
      cardId: result.cardId,
      metadata: { rewardId: reward.id, programId: result.programId },
    });
    c.executionCtx.waitUntil(
      onRewardUnlocked(c.env, db, {
        businessId,
        customerId: result.customer.id,
        cardId: result.cardId,
        programId: result.programId,
        rewardId: reward.id,
        rewardName: reward.name,
      }).catch((err) => console.error("reward automation failed", err)),
    );
  }
}

async function recordFailure(c: Context<AppEnv>, err: unknown, channel: IssueChannel, cardId?: string, type: "issue_failed" | "redeem_failed" = "issue_failed") {
  const reason = err instanceof AppError ? err.code : "INTERNAL";
  await recordEvent(c.get("db"), {
    businessId: c.get("membership").business.id,
    type,
    channel,
    outcome: "failed",
    reason,
    cardId: cardId ?? null,
    actorUserId: c.get("user")?.id,
  });
}

async function cardSummaries(c: Context<AppEnv>, cardIds: string[]) {
  if (!cardIds.length) return [];
  const db = c.get("db");
  const rows = await db
    .select({ card: customerCards, program: loyaltyPrograms, customer: customers })
    .from(customerCards)
    .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, customerCards.programId))
    .innerJoin(customers, eq(customers.id, customerCards.customerId))
    .where(and(inArray(customerCards.id, cardIds), eq(customerCards.businessId, c.get("membership").business.id)))
    .all();
  const rs = await db
    .select()
    .from(rewards)
    .where(and(inArray(rewards.programId, [...new Set(rows.map((r) => r.program.id))]), eq(rewards.isActive, true)))
    .orderBy(asc(rewards.pointsRequired))
    .all();
  return rows.map(({ card, program, customer }) => ({
    id: card.id,
    status: card.status,
    pointsBalance: card.pointsBalance,
    lifetimePoints: card.lifetimePoints,
    visits: card.visits,
    rewardsRedeemed: card.rewardsRedeemed,
    lastVisitAt: card.lastVisitAt,
    joinedAt: card.createdAt,
    customer: { id: customer.id, name: customer.name, phone: customer.phone, phoneVerified: customer.phoneVerified },
    program: { id: program.id, name: program.name, stampsRequired: program.stampsRequired, stampIcon: program.stampIcon, status: program.status },
    rewards: rs
      .filter((r) => r.programId === program.id)
      .map((r) => ({ id: r.id, name: r.name, pointsRequired: r.pointsRequired, redeemable: card.pointsBalance >= r.pointsRequired })),
  }));
}

export const loyaltyOpsRoutes = new Hono<AppEnv>()
  /** Staff scans the rotating QR on a customer's card. */
  .post(
    "/:businessId/issue/scan",
    requireBusiness({ permission: "points.issue" }),
    validate("json", z.object({ token: z.string().min(10).max(300), locationId: z.string().uuid().nullish() })),
    async (c) => {
      const { token, locationId } = c.req.valid("json");
      const { business } = c.get("membership");
      if (!business.qrEnabled) throw new AppError(403, "CHANNEL_DISABLED", "QR point collection is turned off for this business");
      const check = await verifyAnyCardCode(c.env.BETTER_AUTH_SECRET, token);
      if (!check.ok) {
        await recordFailure(c, new AppError(400, `TOKEN_${check.reason.toUpperCase()}`, ""), "qr");
        throw new AppError(
          400,
          check.reason === "expired" ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
          check.reason === "expired" ? "This QR code has expired. Ask the customer to refresh their card." : "This is not a valid loyalty card QR code",
        );
      }
      try {
        const result = await issuePoint(c.get("db"), {
          businessId: business.id,
          cardId: check.cardId,
          channel: "qr",
          actorUserId: c.get("user")!.id,
          locationId: await resolveLocation(c, locationId),
          // Rotating QR: single-use nonce. Wallet code is static, so de-duplicate repeat scans within the same minute.
          idempotencyKey: check.source === "rotating" ? `qr:${check.nonce}` : `wallet:${check.cardId}:${Math.floor(Date.now() / 60_000)}`,
        });
        await afterIssue(c, result, "qr");
        return c.json({ result });
      } catch (err) {
        await recordFailure(c, err, "qr", check.cardId);
        throw err;
      }
    },
  )

  /** Staff-assisted issuance (customer can't show their card). */
  .post(
    "/:businessId/cards/:cardId/points",
    requireBusiness({ permission: "points.issue" }),
    validate("json", z.object({ idempotencyKey, locationId: z.string().uuid().nullish() })),
    async (c) => {
      const body = c.req.valid("json");
      const { business } = c.get("membership");
      const cardId = c.req.param("cardId");
      try {
        const result = await issuePoint(c.get("db"), {
          businessId: business.id,
          cardId,
          channel: "manual",
          actorUserId: c.get("user")!.id,
          locationId: await resolveLocation(c, body.locationId),
          idempotencyKey: `manual:${business.id}:${body.idempotencyKey}`,
        });
        await afterIssue(c, result, "manual");
        return c.json({ result });
      } catch (err) {
        await recordFailure(c, err, "manual", cardId);
        throw err;
      }
    },
  )

  .post(
    "/:businessId/cards/:cardId/redeem",
    requireBusiness({ permission: "rewards.redeem" }),
    validate("json", z.object({ rewardId: z.string().uuid(), idempotencyKey, locationId: z.string().uuid().nullish() })),
    async (c) => {
      const body = c.req.valid("json");
      const { business } = c.get("membership");
      const cardId = c.req.param("cardId");
      try {
        const result = await redeemReward(c.get("db"), {
          businessId: business.id,
          cardId,
          rewardId: body.rewardId,
          actorUserId: c.get("user")!.id,
          locationId: await resolveLocation(c, body.locationId),
          idempotencyKey: `redeem:${business.id}:${body.idempotencyKey}`,
        });
        queueWalletSync(c, cardId);
        await recordEvent(c.get("db"), {
          businessId: business.id,
          type: "redeem_success",
          outcome: "success",
          customerId: result.customer.id,
          cardId,
          actorUserId: c.get("user")!.id,
        });
        return c.json({ result });
      } catch (err) {
        await recordFailure(c, err, "manual", cardId, "redeem_failed");
        throw err;
      }
    },
  )

  /** Find a customer's cards at this business by mobile number. */
  .get("/:businessId/lookup", requireBusiness(), validate("query", z.object({ phone: indianPhone })), async (c) => {
    requireAnyPermission(c, "points.issue", "rewards.redeem", "customers.view");
    const { phone } = c.req.valid("query");
    const { business } = c.get("membership");
    const cards = await c
      .get("db")
      .select({ id: customerCards.id })
      .from(customerCards)
      .innerJoin(customers, eq(customers.id, customerCards.customerId))
      .where(and(eq(customerCards.businessId, business.id), eq(customers.phone, phone)))
      .all();
    return c.json({ cards: await cardSummaries(c, cards.map((x) => x.id)) });
  })

  /** Resolve a scanned card QR to the card (for redemption) without issuing a point. */
  .post(
    "/:businessId/cards/resolve",
    requireBusiness(),
    validate("json", z.object({ token: z.string().min(10).max(300) })),
    async (c) => {
      requireAnyPermission(c, "points.issue", "rewards.redeem");
      const check = await verifyAnyCardCode(c.env.BETTER_AUTH_SECRET, c.req.valid("json").token);
      if (!check.ok) throw new AppError(400, "TOKEN_INVALID", check.reason === "expired" ? "This QR code has expired" : "Not a valid loyalty card QR code");
      const [card] = await cardSummaries(c, [check.cardId]);
      if (!card) throw notFound("Card");
      // A wallet code never changes, so the scanner asks staff to confirm the mobile number before redeeming.
      return c.json({ card, source: check.source });
    },
  )

  .get("/:businessId/cards/:cardId", requireBusiness(), async (c) => {
    requireAnyPermission(c, "points.issue", "rewards.redeem", "customers.view");
    const [card] = await cardSummaries(c, [c.req.param("cardId")]);
    if (!card) throw notFound("Card");
    const history = await c
      .get("db")
      .select({
        id: stampTransactions.id,
        type: stampTransactions.type,
        points: stampTransactions.points,
        channel: stampTransactions.channel,
        createdAt: stampTransactions.createdAt,
        staffName: users.name,
      })
      .from(stampTransactions)
      .leftJoin(users, eq(users.id, stampTransactions.actorUserId))
      .where(and(eq(stampTransactions.cardId, card.id), eq(stampTransactions.businessId, c.get("membership").business.id)))
      .orderBy(desc(stampTransactions.createdAt))
      .limit(100)
      .all();
    return c.json({ card, history });
  })

  .get(
    "/:businessId/transactions",
    requireBusiness({ permission: "customers.view" }),
    validate(
      "query",
      z.object({
        type: z.enum(["earn", "redeem", "adjust"]).optional(),
        channel: z.enum(ISSUE_CHANNELS).optional(),
        before: z.coerce.number().int().optional(),
      }),
    ),
    async (c) => {
      const q = c.req.valid("query");
      const { business } = c.get("membership");
      const rows = await c
        .get("db")
        .select({
          id: stampTransactions.id,
          type: stampTransactions.type,
          points: stampTransactions.points,
          channel: stampTransactions.channel,
          createdAt: stampTransactions.createdAt,
          cardId: stampTransactions.cardId,
          customerName: customers.name,
          programName: loyaltyPrograms.name,
          staffName: users.name,
        })
        .from(stampTransactions)
        .innerJoin(customers, eq(customers.id, stampTransactions.customerId))
        .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, stampTransactions.programId))
        .leftJoin(users, eq(users.id, stampTransactions.actorUserId))
        .where(
          and(
            eq(stampTransactions.businessId, business.id),
            q.type ? eq(stampTransactions.type, q.type) : undefined,
            q.channel ? eq(stampTransactions.channel, q.channel) : undefined,
            q.before ? lt(stampTransactions.createdAt, new Date(q.before)) : undefined,
          ),
        )
        .orderBy(desc(stampTransactions.createdAt))
        .limit(PAGE_SIZE + 1)
        .all();
      const page = rows.slice(0, PAGE_SIZE);
      return c.json({ transactions: page, nextBefore: rows.length > PAGE_SIZE ? page.at(-1)!.createdAt.getTime() : null });
    },
  )

  .get(
    "/:businessId/redemptions",
    requireBusiness(),
    validate("query", z.object({ before: z.coerce.number().int().optional() })),
    async (c) => {
      requireAnyPermission(c, "rewards.redeem", "customers.view");
      const { before } = c.req.valid("query");
      const { business } = c.get("membership");
      const rows = await c
        .get("db")
        .select({
          id: rewardRedemptions.id,
          rewardName: rewardRedemptions.rewardName,
          pointsUsed: rewardRedemptions.pointsUsed,
          createdAt: rewardRedemptions.createdAt,
          cardId: rewardRedemptions.cardId,
          customerName: customers.name,
          staffName: users.name,
        })
        .from(rewardRedemptions)
        .innerJoin(customers, eq(customers.id, rewardRedemptions.customerId))
        .leftJoin(users, eq(users.id, rewardRedemptions.actorUserId))
        .where(and(eq(rewardRedemptions.businessId, business.id), before ? lt(rewardRedemptions.createdAt, new Date(before)) : undefined))
        .orderBy(desc(rewardRedemptions.createdAt))
        .limit(PAGE_SIZE + 1)
        .all();
      const page = rows.slice(0, PAGE_SIZE);
      return c.json({ redemptions: page, nextBefore: rows.length > PAGE_SIZE ? page.at(-1)!.createdAt.getTime() : null });
    },
  )

  /** Pending "tap to collect" requests created when customers tap a business NFC tag. */
  .get("/:businessId/nfc-requests", requireBusiness({ permission: "points.issue" }), async (c) => {
    const m = c.get("membership");
    const rows = await c
      .get("db")
      .select({
        id: nfcSessions.id,
        shortCode: nfcSessions.shortCode,
        channel: nfcSessions.channel,
        createdAt: nfcSessions.createdAt,
        expiresAt: nfcSessions.expiresAt,
        cardId: nfcSessions.cardId,
        customerName: customers.name,
        tagLabel: nfcTags.label,
        locationId: nfcSessions.locationId,
      })
      .from(nfcSessions)
      .innerJoin(customers, eq(customers.id, nfcSessions.customerId))
      .leftJoin(nfcTags, eq(nfcTags.id, nfcSessions.tagId))
      .where(
        and(
          eq(nfcSessions.businessId, m.business.id),
          eq(nfcSessions.status, "pending"),
          gt(nfcSessions.expiresAt, new Date()),
          m.locationId ? or(isNull(nfcSessions.locationId), eq(nfcSessions.locationId, m.locationId)) : undefined,
        ),
      )
      .orderBy(desc(nfcSessions.createdAt))
      .limit(50)
      .all();
    return c.json({ requests: rows });
  })

  .post("/:businessId/nfc-requests/:requestId/:decision{approve|reject}", requireBusiness({ permission: "points.issue" }), async (c) => {
    const db = c.get("db");
    const m = c.get("membership");
    const user = c.get("user")!;
    const decision = c.req.param("decision") as "approve" | "reject";
    const session = await db
      .select()
      .from(nfcSessions)
      .where(and(eq(nfcSessions.id, c.req.param("requestId")), eq(nfcSessions.businessId, m.business.id)))
      .get();
    if (!session || (m.locationId && session.locationId && session.locationId !== m.locationId)) throw notFound("Request");
    if (session.status !== "pending") throw new AppError(409, "ALREADY_RESOLVED", `This request was already ${session.status}`);
    if (session.expiresAt.getTime() < Date.now()) {
      await db.update(nfcSessions).set({ status: "expired" }).where(eq(nfcSessions.id, session.id));
      throw new AppError(409, "REQUEST_EXPIRED", "This request has expired. Ask the customer to tap again.");
    }

    if (decision === "reject") {
      await db
        .update(nfcSessions)
        .set({ status: "rejected", resolvedByUserId: user.id, resolvedAt: new Date() })
        .where(and(eq(nfcSessions.id, session.id), eq(nfcSessions.status, "pending")));
      return c.json({ ok: true });
    }

    try {
      const result = await issuePoint(db, {
        businessId: m.business.id,
        cardId: session.cardId,
        channel: session.channel,
        actorUserId: user.id,
        locationId: session.locationId ?? (await resolveLocation(c, null)),
        idempotencyKey: `nfc:${session.id}`,
        nfcTagId: session.tagId,
        extra: (transactionId) => [
          db
            .update(nfcSessions)
            .set({ status: "approved", resolvedByUserId: user.id, resolvedAt: new Date(), transactionId })
            .where(eq(nfcSessions.id, session.id)),
        ],
      });
      await afterIssue(c, result, session.channel);
      return c.json({ result });
    } catch (err) {
      if (err instanceof EngineError && err.engineCode !== "DUPLICATE") {
        await db
          .update(nfcSessions)
          .set({ status: "rejected", resolvedByUserId: user.id, resolvedAt: new Date(), failureReason: err.code })
          .where(and(eq(nfcSessions.id, session.id), eq(nfcSessions.status, "pending")));
      }
      await recordFailure(c, err, session.channel, session.cardId);
      throw err;
    }
  });

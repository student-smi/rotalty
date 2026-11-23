import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "../db/client";
import { customerCards, customers, loyaltyPrograms, rewardRedemptions, rewards, stampTransactions } from "../db/schema";
import { AppError } from "../lib/errors";
import { istDateString, istDayStart, type IssueChannel } from "../../shared/domain";

export type EngineErrorCode =
  | "CARD_NOT_FOUND"
  | "CARD_BLOCKED"
  | "PROGRAM_INACTIVE"
  | "DUPLICATE"
  | "DAILY_LIMIT"
  | "COOLDOWN"
  | "REWARD_NOT_FOUND"
  | "INSUFFICIENT_POINTS";

const MESSAGES: Record<EngineErrorCode, string> = {
  CARD_NOT_FOUND: "Loyalty card not found for this business",
  CARD_BLOCKED: "This loyalty card is blocked",
  PROGRAM_INACTIVE: "This loyalty program is not active right now",
  DUPLICATE: "This was already processed",
  DAILY_LIMIT: "Daily point limit reached for this customer",
  COOLDOWN: "Please wait before collecting another point",
  REWARD_NOT_FOUND: "Reward not found",
  INSUFFICIENT_POINTS: "Not enough points for this reward",
};

export class EngineError extends AppError {
  constructor(
    public engineCode: EngineErrorCode,
    details?: unknown,
  ) {
    const status = engineCode === "CARD_NOT_FOUND" || engineCode === "REWARD_NOT_FOUND" ? 404 : 409;
    super(status, engineCode, MESSAGES[engineCode], details);
  }
}

function errorText(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let i = 0; e && i < 4; i++) {
    parts.push(String((e as Error).message ?? e));
    e = (e as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

async function loadCard(db: DB, businessId: string, cardId: string) {
  const row = await db
    .select({ card: customerCards, program: loyaltyPrograms, customer: { id: customers.id, name: customers.name, phone: customers.phone } })
    .from(customerCards)
    .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, customerCards.programId))
    .innerJoin(customers, eq(customers.id, customerCards.customerId))
    .where(and(eq(customerCards.id, cardId), eq(customerCards.businessId, businessId)))
    .get();
  if (!row) throw new EngineError("CARD_NOT_FOUND");
  return row;
}

export function isProgramLive(p: typeof loyaltyPrograms.$inferSelect, now = Date.now()) {
  return (
    p.status === "active" &&
    !p.deletedAt &&
    (!p.startsAt || p.startsAt.getTime() <= now) &&
    (!p.endsAt || p.endsAt.getTime() > now)
  );
}

export interface IssueInput {
  businessId: string;
  cardId: string;
  channel: IssueChannel;
  actorUserId: string | null;
  locationId: string | null;
  idempotencyKey: string;
  nfcTagId?: string | null;
  /** Extra statements committed atomically with the point (e.g. marking an NFC request approved). */
  extra?: (transactionId: string) => BatchItem<"sqlite">[];
}

export interface IssueResult {
  transactionId: string;
  cardId: string;
  customer: { id: string; name: string };
  pointsBalance: number;
  stampsRequired: number;
  unlockedRewards: { id: string; name: string; pointsRequired: number }[];
  programId: string;
}

/** The only code path that adds loyalty points. QR, NFC tag, phone NFC and manual issuance all call this. */
export async function issuePoint(db: DB, input: IssueInput): Promise<IssueResult> {
  const { card, program, customer } = await loadCard(db, input.businessId, input.cardId);
  if (card.status !== "active") throw new EngineError("CARD_BLOCKED");
  if (!isProgramLive(program)) throw new EngineError("PROGRAM_INACTIVE");

  const dup = await db
    .select({ id: stampTransactions.id })
    .from(stampTransactions)
    .where(eq(stampTransactions.idempotencyKey, input.idempotencyKey))
    .get();
  if (dup) throw new EngineError("DUPLICATE");

  const [todays, last] = await db.batch([
    db
      .select({ n: count() })
      .from(stampTransactions)
      .where(and(eq(stampTransactions.cardId, card.id), eq(stampTransactions.type, "earn"), gte(stampTransactions.createdAt, istDayStart()))),
    db
      .select({ createdAt: stampTransactions.createdAt })
      .from(stampTransactions)
      .where(and(eq(stampTransactions.cardId, card.id), eq(stampTransactions.type, "earn")))
      .orderBy(desc(stampTransactions.createdAt))
      .limit(1),
  ]);
  const earnedToday = todays[0]?.n ?? 0;
  if (earnedToday >= program.dailyLimitPerCustomer) throw new EngineError("DAILY_LIMIT");
  const lastAt = last[0]?.createdAt?.getTime();
  if (program.cooldownMinutes > 0 && lastAt && Date.now() - lastAt < program.cooldownMinutes * 60_000) {
    throw new EngineError("COOLDOWN", { retryAfterSeconds: Math.ceil((lastAt + program.cooldownMinutes * 60_000 - Date.now()) / 1000) });
  }

  const transactionId = crypto.randomUUID();
  const now = new Date();
  try {
    await db.batch([
      db.insert(stampTransactions).values({
        id: transactionId,
        businessId: input.businessId,
        programId: program.id,
        cardId: card.id,
        customerId: card.customerId,
        type: "earn",
        points: 1,
        channel: input.channel,
        actorUserId: input.actorUserId,
        locationId: input.locationId,
        nfcTagId: input.nfcTagId ?? null,
        idempotencyKey: input.idempotencyKey,
        dailySlot: `${card.id}:${istDateString(now)}:${earnedToday + 1}`,
      }),
      db
        .update(customerCards)
        .set({
          pointsBalance: sql`${customerCards.pointsBalance} + 1`,
          lifetimePoints: sql`${customerCards.lifetimePoints} + 1`,
          visits: sql`${customerCards.visits} + 1`,
          lastVisitAt: now,
        })
        .where(eq(customerCards.id, card.id)),
      ...(input.extra?.(transactionId) ?? []),
    ]);
  } catch (err) {
    const text = errorText(err);
    if (text.includes("idempotency_key")) throw new EngineError("DUPLICATE");
    if (text.includes("daily_slot")) throw new EngineError("DAILY_LIMIT");
    throw err;
  }

  const fresh = await db
    .select({ pointsBalance: customerCards.pointsBalance })
    .from(customerCards)
    .where(eq(customerCards.id, card.id))
    .get();
  const balance = fresh!.pointsBalance;
  const unlocked = await db
    .select({ id: rewards.id, name: rewards.name, pointsRequired: rewards.pointsRequired })
    .from(rewards)
    .where(and(eq(rewards.programId, program.id), eq(rewards.isActive, true), eq(rewards.pointsRequired, balance)))
    .all();

  return {
    transactionId,
    cardId: card.id,
    customer: { id: customer.id, name: customer.name },
    pointsBalance: balance,
    stampsRequired: program.stampsRequired,
    unlockedRewards: unlocked,
    programId: program.id,
  };
}

export interface RedeemInput {
  businessId: string;
  cardId: string;
  rewardId: string;
  actorUserId: string;
  locationId: string | null;
  idempotencyKey: string;
}

export async function redeemReward(db: DB, input: RedeemInput) {
  const { card, program, customer } = await loadCard(db, input.businessId, input.cardId);
  if (card.status !== "active") throw new EngineError("CARD_BLOCKED");
  const reward = await db
    .select()
    .from(rewards)
    .where(and(eq(rewards.id, input.rewardId), eq(rewards.programId, program.id), eq(rewards.isActive, true)))
    .get();
  if (!reward) throw new EngineError("REWARD_NOT_FOUND");
  if (card.pointsBalance < reward.pointsRequired) throw new EngineError("INSUFFICIENT_POINTS");

  const transactionId = crypto.randomUUID();
  const redemptionId = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(stampTransactions).values({
        id: transactionId,
        businessId: input.businessId,
        programId: program.id,
        cardId: card.id,
        customerId: card.customerId,
        type: "redeem",
        points: -reward.pointsRequired,
        channel: "manual",
        actorUserId: input.actorUserId,
        locationId: input.locationId,
        rewardId: reward.id,
        idempotencyKey: input.idempotencyKey,
      }),
      db.insert(rewardRedemptions).values({
        id: redemptionId,
        businessId: input.businessId,
        programId: program.id,
        cardId: card.id,
        customerId: card.customerId,
        rewardId: reward.id,
        rewardName: reward.name,
        pointsUsed: reward.pointsRequired,
        actorUserId: input.actorUserId,
        locationId: input.locationId,
        transactionId,
      }),
      // The CHECK (points_balance >= 0) constraint aborts the batch if a concurrent redemption got there first.
      db
        .update(customerCards)
        .set({
          pointsBalance: sql`${customerCards.pointsBalance} - ${reward.pointsRequired}`,
          rewardsRedeemed: sql`${customerCards.rewardsRedeemed} + 1`,
        })
        .where(eq(customerCards.id, card.id)),
    ]);
  } catch (err) {
    const text = errorText(err);
    if (text.includes("idempotency_key")) throw new EngineError("DUPLICATE");
    if (text.includes("cards_points_nonneg") || text.includes("CHECK constraint")) throw new EngineError("INSUFFICIENT_POINTS");
    throw err;
  }

  const fresh = await db.select({ pointsBalance: customerCards.pointsBalance }).from(customerCards).where(eq(customerCards.id, card.id)).get();
  return {
    redemptionId,
    transactionId,
    reward: { id: reward.id, name: reward.name, pointsRequired: reward.pointsRequired },
    customer: { id: customer.id, name: customer.name },
    pointsBalance: fresh!.pointsBalance,
  };
}

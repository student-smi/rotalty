import { and, count, countDistinct, eq, gte, isNull, ne, notInArray } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  aiUsageLogs,
  businesses,
  businessLocations,
  businessStaff,
  customerCards,
  loyaltyPrograms,
  notificationLogs,
  staffInvitations,
  subscriptionPlans,
  subscriptions,
} from "../db/schema";
import { AppError } from "../lib/errors";
import { istMonthStart, PLAN_LIMIT_LABELS, type PlanLimits } from "../../shared/domain";

export type Plan = typeof subscriptionPlans.$inferSelect;

export interface AccountPlan {
  plan: Plan;
  subscription: typeof subscriptions.$inferSelect | null;
}

export async function getPlanForUser(db: DB, userId: string): Promise<AccountPlan> {
  const row = await db
    .select({ sub: subscriptions, plan: subscriptionPlans })
    .from(subscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
    .where(eq(subscriptions.userId, userId))
    .get();
  const now = Date.now();
  if (row && row.sub.status === "active" && (!row.sub.currentPeriodEnd || row.sub.currentPeriodEnd.getTime() > now)) {
    return { plan: row.plan, subscription: row.sub };
  }
  const free = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.code, "free")).get();
  if (!free) throw new AppError(500, "PLAN_MISSING", "Free plan is not configured");
  return { plan: free, subscription: row?.sub ?? null };
}

export async function getPlanForBusiness(db: DB, businessId: string): Promise<AccountPlan> {
  const biz = await db.select({ ownerUserId: businesses.ownerUserId }).from(businesses).where(eq(businesses.id, businessId)).get();
  if (!biz) throw new AppError(404, "NOT_FOUND", "Business not found");
  return getPlanForUser(db, biz.ownerUserId);
}

type CountedLimit = Exclude<keyof PlanLimits, "nfc" | "marketing" | "advancedAnalytics">;
type FeatureLimit = "nfc" | "marketing" | "advancedAnalytics";

function limitError(key: keyof PlanLimits, plan: Plan, limit?: number) {
  const label = PLAN_LIMIT_LABELS[key];
  const msg =
    limit === undefined
      ? `${label} is not included in the ${plan.name} plan. Upgrade to use it.`
      : `Your ${plan.name} plan allows ${limit} ${label.toLowerCase()}. Upgrade your plan to add more.`;
  return new AppError(403, "PLAN_LIMIT_REACHED", msg, { limit: key });
}

export async function assertFeature(db: DB, businessId: string, feature: FeatureLimit) {
  const { plan } = await getPlanForBusiness(db, businessId);
  if (!plan.limits[feature]) throw limitError(feature, plan);
  return plan;
}

/** Current usage for a counted limit, scoped to the business (or the owner account for `businesses`). */
export async function currentUsage(db: DB, key: CountedLimit, scope: { businessId?: string; userId?: string }): Promise<number> {
  const bid = scope.businessId!;
  switch (key) {
    case "businesses": {
      const r = await db
        .select({ n: count() })
        .from(businesses)
        .where(and(eq(businesses.ownerUserId, scope.userId!), isNull(businesses.deletedAt)))
        .get();
      return r?.n ?? 0;
    }
    case "locationsPerBusiness": {
      const r = await db
        .select({ n: count() })
        .from(businessLocations)
        .where(and(eq(businessLocations.businessId, bid), isNull(businessLocations.deletedAt)))
        .get();
      return r?.n ?? 0;
    }
    case "staffPerBusiness": {
      const [members, invites] = await db.batch([
        db
          .select({ n: count() })
          .from(businessStaff)
          .where(and(eq(businessStaff.businessId, bid), eq(businessStaff.status, "active"))),
        db
          .select({ n: count() })
          .from(staffInvitations)
          .where(
            and(
              eq(staffInvitations.businessId, bid),
              isNull(staffInvitations.acceptedAt),
              isNull(staffInvitations.revokedAt),
              gte(staffInvitations.expiresAt, new Date()),
            ),
          ),
      ]);
      return (members[0]?.n ?? 0) + (invites[0]?.n ?? 0);
    }
    case "customersPerBusiness": {
      const r = await db
        .select({ n: countDistinct(customerCards.customerId) })
        .from(customerCards)
        .where(eq(customerCards.businessId, bid))
        .get();
      return r?.n ?? 0;
    }
    case "programsPerBusiness": {
      const r = await db
        .select({ n: count() })
        .from(loyaltyPrograms)
        .where(and(eq(loyaltyPrograms.businessId, bid), isNull(loyaltyPrograms.deletedAt), ne(loyaltyPrograms.status, "archived")))
        .get();
      return r?.n ?? 0;
    }
    case "aiGenerationsPerMonth": {
      const r = await db
        .select({ n: count() })
        .from(aiUsageLogs)
        .where(and(eq(aiUsageLogs.businessId, bid), eq(aiUsageLogs.status, "success"), gte(aiUsageLogs.createdAt, istMonthStart())))
        .get();
      return r?.n ?? 0;
    }
    case "campaignMessagesPerMonth": {
      const r = await db
        .select({ n: count() })
        .from(notificationLogs)
        .where(
          and(
            eq(notificationLogs.businessId, bid),
            notInArray(notificationLogs.status, ["skipped", "failed"]),
            gte(notificationLogs.createdAt, istMonthStart()),
          ),
        )
        .get();
      return r?.n ?? 0;
    }
  }
}

/** Throws PLAN_LIMIT_REACHED if adding `adding` more units would exceed the plan. Returns the remaining allowance. */
export async function assertWithinLimit(
  db: DB,
  key: CountedLimit,
  scope: { businessId?: string; userId?: string },
  adding = 1,
): Promise<number | null> {
  const { plan } = scope.userId && !scope.businessId ? await getPlanForUser(db, scope.userId) : await getPlanForBusiness(db, scope.businessId!);
  const limit = plan.limits[key];
  if (limit === null || limit === undefined) return null;
  const used = await currentUsage(db, key, scope);
  if (used + adding > limit) throw limitError(key, plan, limit);
  return limit - used - adding;
}

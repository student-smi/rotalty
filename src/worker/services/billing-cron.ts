import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { DB } from "../db/client";
import { subscriptions } from "../db/schema";

/** Daily: mark subscriptions whose paid period has ended as expired (accounts fall back to the Free plan). */
export async function expireSubscriptions(db: DB): Promise<void> {
  await db
    .update(subscriptions)
    .set({ status: "expired" })
    .where(and(eq(subscriptions.status, "active"), isNotNull(subscriptions.currentPeriodEnd), lt(subscriptions.currentPeriodEnd, new Date())));
}

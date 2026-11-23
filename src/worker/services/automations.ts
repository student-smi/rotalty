import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { businesses, marketingCampaigns } from "../db/schema";
import { getPlanForBusiness } from "./plans";
import { audience } from "./segments";
import { enqueueMessages } from "./marketing-cron";
import { istDateString } from "../../shared/domain";

export interface RewardUnlockedEvent {
  businessId: string;
  customerId: string;
  cardId: string;
  programId: string;
  rewardId: string;
  rewardName: string;
}

/**
 * Called by the loyalty engine after a point crosses a reward threshold.
 * Enqueues the business's active "reward unlocked" WhatsApp automation for that customer (consent-gated).
 */
export async function onRewardUnlocked(env: Env, db: DB, event: RewardUnlockedEvent): Promise<void> {
  const row = await db
    .select({ campaign: marketingCampaigns, businessName: businesses.name })
    .from(marketingCampaigns)
    .innerJoin(businesses, eq(businesses.id, marketingCampaigns.businessId))
    .where(
      and(
        eq(marketingCampaigns.businessId, event.businessId),
        eq(marketingCampaigns.type, "reward_unlock"),
        eq(marketingCampaigns.mode, "automation"),
        eq(marketingCampaigns.status, "active"),
      ),
    )
    .get();
  if (!row) return;
  const { plan } = await getPlanForBusiness(db, event.businessId);
  if (!plan.limits.marketing) return;

  const [person] = await audience(env.DB, event.businessId, { where: "AND c.id = ?", whereParams: [event.customerId] });
  if (!person?.phone) return;

  await enqueueMessages(
    db,
    row.campaign,
    { id: event.businessId, name: row.businessName },
    [
      {
        customerId: person.customerId,
        name: person.name,
        phone: person.phone,
        points: person.pointsBalance,
        reward: event.rewardName,
        dedupeKey: `reward:${row.campaign.id}:${event.cardId}:${event.rewardId}:${istDateString()}`,
      },
    ],
    // A reward notification is expected by the customer, so it isn't held back by the 24h promotional cap.
    { frequencyCap: false, onLimit: "truncate" },
  );
}

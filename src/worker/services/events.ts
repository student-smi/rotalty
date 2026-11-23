import type { DB } from "../db/client";
import { interactionEvents } from "../db/schema";

export type EventType =
  | "qr_scan"
  | "nfc_tap"
  | "nfc_request"
  | "issue_success"
  | "issue_failed"
  | "reward_unlocked"
  | "redeem_success"
  | "redeem_failed"
  | "device_unsupported"
  | "card_joined"
  | "review_visit"
  | "review_generated"
  | "review_failed"
  | "review_redirect";

export interface EventInput {
  businessId: string;
  type: EventType;
  channel?: string | null;
  outcome?: string | null;
  reason?: string | null;
  customerId?: string | null;
  cardId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export function eventInsert(db: DB, e: EventInput) {
  return db.insert(interactionEvents).values(e);
}

/** Fire-and-forget; analytics must never break the request that produced the event. */
export async function recordEvent(db: DB, e: EventInput) {
  try {
    await eventInsert(db, e);
  } catch (err) {
    console.error("Failed to record event", e.type, err);
  }
}

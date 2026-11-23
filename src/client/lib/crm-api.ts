import type { CustomerSegment } from "../../shared/domain";

export interface CrmCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  deleted: boolean;
  cards: number;
  visits: number;
  pointsBalance: number;
  lifetimePoints: number;
  rewardsRedeemed: number;
  lastVisitAt: string | null;
  joinedAt: string;
  segments: CustomerSegment[];
  whatsappOptIn: boolean;
}

export type SegmentStats = Record<CustomerSegment | "total" | "optedIn", number>;

export interface CrmCustomerDetail {
  customer: CrmCustomer;
  cards: {
    id: string;
    status: "active" | "blocked";
    programName: string;
    stampsRequired: number;
    pointsBalance: number;
    lifetimePoints: number;
    visits: number;
    rewardsRedeemed: number;
    lastVisitAt: string | null;
    joinedAt: string;
    rewards: { name: string; pointsRequired: number }[];
  }[];
  history: { id: string; type: "earn" | "redeem" | "adjust"; points: number; channel: string; createdAt: string; programName: string; staffName: string | null }[];
  redemptions: { id: string; rewardName: string; pointsUsed: number; createdAt: string }[];
  consents: { channel: "whatsapp" | "sms" | "email"; status: "granted" | "withdrawn" | null; source: string | null; grantedAt: string | null; withdrawnAt: string | null }[];
}

export const SEGMENT_LABELS: Record<CustomerSegment, string> = {
  new: "New",
  regular: "Regular",
  loyal: "Loyal",
  inactive: "Inactive",
  reward_eligible: "Reward ready",
};

export const SEGMENT_TONES: Record<CustomerSegment, "neutral" | "success" | "warning" | "danger" | "brand"> = {
  new: "brand",
  regular: "neutral",
  loyal: "success",
  inactive: "warning",
  reward_eligible: "success",
};

export const CHANNEL_LABELS: Record<string, string> = { qr: "QR scan", nfc_tag: "NFC tag", nfc_phone: "Phone NFC", manual: "Staff" };

export function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export function relativeDays(iso: string | null) {
  if (!iso) return "Never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}

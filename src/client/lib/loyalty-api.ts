import { ApiError } from "./api";
import type { ProgramStatus } from "../../shared/domain";

export const STAMP_ICONS = ["star", "coffee", "heart", "scissors", "cake", "dumbbell", "bag", "leaf", "gift", "drop"] as const;
export type StampIcon = (typeof STAMP_ICONS)[number];

export const STAMP_EMOJI: Record<string, string> = {
  star: "⭐",
  coffee: "☕",
  heart: "❤️",
  scissors: "✂️",
  cake: "🎂",
  dumbbell: "🏋️",
  bag: "🛍️",
  leaf: "🍃",
  gift: "🎁",
  drop: "💧",
};

export const stampEmoji = (icon: string | null | undefined) => STAMP_EMOJI[icon ?? "star"] ?? "⭐";

export interface Reward {
  id: string;
  programId: string;
  name: string;
  description: string | null;
  pointsRequired: number;
  isActive: boolean;
}

export interface Program {
  id: string;
  name: string;
  description: string | null;
  stampIcon: string;
  stampsRequired: number;
  minPurchaseAmount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  eligibility: string | null;
  terms: string | null;
  status: ProgramStatus;
  dailyLimitPerCustomer: number;
  cooldownMinutes: number;
  createdAt: string;
  rewards: Reward[];
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

export interface RedeemResult {
  redemptionId: string;
  reward: { id: string; name: string; pointsRequired: number };
  customer: { id: string; name: string };
  pointsBalance: number;
}

export interface StaffCardSummary {
  id: string;
  status: "active" | "blocked";
  pointsBalance: number;
  lifetimePoints: number;
  visits: number;
  rewardsRedeemed: number;
  lastVisitAt: string | null;
  customer: { id: string; name: string; phone: string | null; phoneVerified: boolean };
  program: { id: string; name: string; stampsRequired: number; stampIcon: string; status: ProgramStatus };
  rewards: { id: string; name: string; pointsRequired: number; redeemable: boolean }[];
}

export interface QrCodeRow {
  id: string;
  code: string;
  label: string;
  locationId: string | null;
  status: "active" | "revoked";
  scanCount: number;
  lastScannedAt: string | null;
  createdAt: string;
  url: string;
}

export interface NfcTagRow {
  id: string;
  code: string;
  label: string;
  locationId: string | null;
  status: "active" | "revoked";
  replacedById: string | null;
  tapCount: number;
  lastTapAt: string | null;
  createdAt: string;
  url: string;
}

export interface ChannelsResponse {
  settings: { qrEnabled: boolean; nfcTagEnabled: boolean; nfcPhoneEnabled: boolean };
  capabilities: { nfcIncludedInPlan: boolean; nfcPhoneSupported: boolean };
  businessPageUrl: string;
  qrCodes: QrCodeRow[];
  nfcTags: NfcTagRow[];
}

export interface NfcRequestRow {
  id: string;
  shortCode: string;
  channel: string;
  createdAt: string;
  expiresAt: string;
  cardId: string;
  customerName: string;
  tagLabel: string | null;
}

export interface CustomerCard {
  id: string;
  status: "active" | "blocked";
  pointsBalance: number;
  lifetimePoints: number;
  visits: number;
  rewardsRedeemed: number;
  lastVisitAt: string | null;
  joinedAt: string;
  business: { id: string; name: string; slug: string; logoUrl: string | null; active: boolean; qrEnabled: boolean; nfcTagEnabled: boolean; reviewButton: boolean };
  googleWallet: boolean;
  program: {
    id: string;
    name: string;
    description: string | null;
    stampIcon: string;
    stampsRequired: number;
    endsAt: string | null;
    terms: string | null;
    live: boolean;
  };
  rewards: { id: string; name: string; description: string | null; pointsRequired: number; unlocked: boolean }[];
}

export interface CustomerSession {
  customer: { id: string; name: string; phone: string | null; email: string | null; birthday: string | null; phoneVerified: boolean } | null;
  otpAvailable: boolean;
  /** "phone": mobile number alone opens the cards; "otp": a one-time code is required. */
  loginMode: "phone" | "otp";
}

export interface PublicBusiness {
  business: {
    id: string;
    name: string;
    slug: string;
    category: string;
    description: string | null;
    city: string | null;
    addressLine: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
  channels: { qr: boolean; nfcTag: boolean };
  programs: {
    id: string;
    name: string;
    description: string | null;
    stampIcon: string;
    stampsRequired: number;
    minPurchaseAmount: number | null;
    endsAt: string | null;
    eligibility: string | null;
    terms: string | null;
    rewards: { id: string; name: string; description: string | null; pointsRequired: number }[];
  }[];
  reviewAssistant: boolean;
  customer: { name: string } | null;
  myCards: { id: string; programId: string; pointsBalance: number }[];
}

export interface NfcRequestStatus {
  id: string;
  shortCode: string;
  status: "pending" | "approved" | "rejected" | "expired";
  expiresAt: string;
  failureReason?: string | null;
}

const FRIENDLY: Record<string, string> = {
  TOKEN_EXPIRED: "This QR code has expired. Ask the customer to refresh their card and scan again.",
  TOKEN_INVALID: "That isn't a valid loyalty card QR code.",
  DUPLICATE: "This QR code was already used. Ask the customer to show the refreshed code.",
  DAILY_LIMIT: "This customer has already collected today's maximum points.",
  COOLDOWN: "Too soon since the last point. Please wait before adding another.",
  PROGRAM_INACTIVE: "This loyalty program isn't active right now.",
  CHANNEL_DISABLED: "QR point collection is turned off. Turn it on in QR & NFC settings.",
  CARD_BLOCKED: "This loyalty card is blocked.",
  CARD_NOT_FOUND: "This card doesn't belong to your business.",
  INSUFFICIENT_POINTS: "Not enough points for this reward.",
  REWARD_NOT_FOUND: "That reward is no longer available.",
  REQUEST_EXPIRED: "This request expired. Ask the customer to tap the tag again.",
  ALREADY_RESOLVED: "This request was already handled.",
};

export function friendlyError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiError) return FRIENDLY[err.code] ?? err.message ?? fallback;
  return fallback;
}

export function newIdempotencyKey() {
  return crypto.randomUUID();
}

export const formatDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const formatDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

/** Only allow same-origin relative redirects. */
export function safeRelative(next: string | null, fallback: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

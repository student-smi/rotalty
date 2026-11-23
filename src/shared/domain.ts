export const ISSUE_CHANNELS = ["qr", "nfc_tag", "nfc_phone", "manual"] as const;
export type IssueChannel = (typeof ISSUE_CHANNELS)[number];

export const PROGRAM_STATUSES = ["draft", "active", "paused", "archived"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export const CONSENT_CHANNELS = ["whatsapp", "sms", "email"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

export const REVIEW_LANGUAGES = ["en", "hi", "gu", "hinglish"] as const;
export type ReviewLanguage = (typeof REVIEW_LANGUAGES)[number];

export const REVIEW_LANGUAGE_LABELS: Record<ReviewLanguage, string> = {
  en: "English",
  hi: "हिन्दी",
  gu: "ગુજરાતી",
  hinglish: "Hinglish",
};

export const CAMPAIGN_TYPES = ["birthday", "winback", "reward_unlock", "progress", "occasion", "inactive"] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const CUSTOMER_SEGMENTS = ["new", "regular", "loyal", "inactive", "reward_eligible"] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

/** `null` means unlimited. */
export interface PlanLimits {
  businesses: number | null;
  locationsPerBusiness: number | null;
  staffPerBusiness: number | null;
  customersPerBusiness: number | null;
  programsPerBusiness: number | null;
  aiGenerationsPerMonth: number | null;
  campaignMessagesPerMonth: number | null;
  nfc: boolean;
  marketing: boolean;
  advancedAnalytics: boolean;
}

export const PLAN_LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  businesses: "Businesses",
  locationsPerBusiness: "Locations per business",
  staffPerBusiness: "Team members per business",
  customersPerBusiness: "Customers per business",
  programsPerBusiness: "Loyalty programs per business",
  aiGenerationsPerMonth: "AI review generations / month",
  campaignMessagesPerMonth: "WhatsApp messages / month",
  nfc: "NFC tags",
  marketing: "Marketing automation",
  advancedAnalytics: "Advanced analytics",
};

/** IST is a fixed UTC+05:30 offset with no DST, so day boundaries can be computed without tz data. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function istDayStart(d: Date = new Date()): Date {
  const [y, m, day] = istDateString(d).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day) - IST_OFFSET_MS);
}

export function istMonthStart(d: Date = new Date()): Date {
  const [y, m] = istDateString(d).split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS);
}

/** Card QR payload prefix, so the staff scanner can tell card tokens apart from other QR codes. */
export const CARD_TOKEN_PREFIX = "LRC1:";

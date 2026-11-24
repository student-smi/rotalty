import { sql } from "drizzle-orm";
import { blob, check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { BusinessCategory, Permission, StaffRole } from "../../shared/permissions";
import type {
  CampaignType,
  ConsentChannel,
  IssueChannel,
  PlanLimits,
  ReviewLanguage,
} from "../../shared/domain";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date());
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());
const deletedAt = () => integer("deleted_at", { mode: "timestamp_ms" });

// ---------- Better Auth core tables (JS keys must match Better Auth field names) ----------

export const users = sqliteTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role", { enum: ["user", "super_admin"] }).notNull().default("user"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: id(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ---------- Tenancy ----------

export const businesses = sqliteTable(
  "businesses",
  {
    id: id(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    category: text("category").$type<BusinessCategory>().notNull(),
    description: text("description"),
    phone: text("phone"),
    email: text("email"),
    addressLine: text("address_line"),
    city: text("city"),
    state: text("state"),
    pincode: text("pincode"),
    /** Google Places (New) place id, set when the owner picks their shop from Google search. */
    googlePlaceId: text("google_place_id"),
    /** Shown as contact buttons on the customer's card and shop page. */
    whatsappNumber: text("whatsapp_number"),
    instagramHandle: text("instagram_handle"),
    websiteUrl: text("website_url"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    logoKey: text("logo_key"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    suspendedReason: text("suspended_reason"),
    qrEnabled: integer("qr_enabled", { mode: "boolean" }).notNull().default(true),
    nfcTagEnabled: integer("nfc_tag_enabled", { mode: "boolean" }).notNull().default(false),
    nfcPhoneEnabled: integer("nfc_phone_enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex("businesses_slug_uq").on(t.slug), index("businesses_owner_idx").on(t.ownerUserId)],
);

export const businessLocations = sqliteTable(
  "business_locations",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    addressLine: text("address_line"),
    city: text("city"),
    state: text("state"),
    pincode: text("pincode"),
    phone: text("phone"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("locations_business_idx").on(t.businessId)],
);

export const businessStaff = sqliteTable(
  "business_staff",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").$type<StaffRole>().notNull(),
    // null = role defaults; otherwise an explicit permission list chosen by the owner.
    permissions: text("permissions", { mode: "json" }).$type<Permission[] | null>(),
    locationId: text("location_id").references(() => businessLocations.id),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("staff_business_user_uq").on(t.businessId, t.userId),
    index("staff_user_idx").on(t.userId),
  ],
);

export const staffInvitations = sqliteTable(
  "staff_invitations",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    email: text("email").notNull(),
    role: text("role").$type<Exclude<StaffRole, "owner">>().notNull(),
    permissions: text("permissions", { mode: "json" }).$type<Permission[] | null>(),
    locationId: text("location_id").references(() => businessLocations.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invitations_token_uq").on(t.tokenHash),
    index("invitations_business_idx").on(t.businessId),
  ],
);

// ---------- Audit ----------

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: id(),
    businessId: text("business_id").references(() => businesses.id),
    actorUserId: text("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("audit_business_created_idx").on(t.businessId, t.createdAt),
    index("audit_actor_idx").on(t.actorUserId),
  ],
);

// ---------- Media (stored in D1; small files only) ----------

export const media = sqliteTable(
  "media",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("media_business_idx").on(t.businessId)],
);

// ---------- Loyalty ----------

export const loyaltyPrograms = sqliteTable(
  "loyalty_programs",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    description: text("description"),
    stampIcon: text("stamp_icon").notNull().default("star"),
    stampsRequired: integer("stamps_required").notNull(),
    minPurchaseAmount: integer("min_purchase_amount"),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }),
    eligibility: text("eligibility"),
    terms: text("terms"),
    status: text("status", { enum: ["draft", "active", "paused", "archived"] }).notNull().default("active"),
    dailyLimitPerCustomer: integer("daily_limit_per_customer").notNull().default(1),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("programs_business_idx").on(t.businessId)],
);

export const rewards = sqliteTable(
  "rewards",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    programId: text("program_id")
      .notNull()
      .references(() => loyaltyPrograms.id),
    name: text("name").notNull(),
    description: text("description"),
    pointsRequired: integer("points_required").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rewards_program_idx").on(t.programId)],
);

export const customers = sqliteTable(
  "customers",
  {
    id: id(),
    // Normalised 10-digit Indian mobile. NULL after the customer deletes their data.
    phone: text("phone"),
    phoneVerified: integer("phone_verified", { mode: "boolean" }).notNull().default(false),
    name: text("name").notNull(),
    email: text("email"),
    birthday: text("birthday"), // MM-DD
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex("customers_phone_uq").on(t.phone)],
);

export const customerSessions = sqliteTable(
  "customer_sessions",
  {
    id: id(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("customer_sessions_token_uq").on(t.tokenHash), index("customer_sessions_customer_idx").on(t.customerId)],
);

export const otpCodes = sqliteTable(
  "otp_codes",
  {
    id: id(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("otp_phone_created_idx").on(t.phone, t.createdAt)],
);

export const customerCards = sqliteTable(
  "customer_cards",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    programId: text("program_id")
      .notNull()
      .references(() => loyaltyPrograms.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    pointsBalance: integer("points_balance").notNull().default(0),
    lifetimePoints: integer("lifetime_points").notNull().default(0),
    visits: integer("visits").notNull().default(0),
    rewardsRedeemed: integer("rewards_redeemed").notNull().default(0),
    lastVisitAt: integer("last_visit_at", { mode: "timestamp_ms" }),
    status: text("status", { enum: ["active", "blocked"] }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("cards_program_customer_uq").on(t.programId, t.customerId),
    index("cards_business_idx").on(t.businessId),
    index("cards_customer_idx").on(t.customerId),
    // Makes over-redemption impossible even under concurrent requests: the whole batch aborts.
    check("cards_points_nonneg", sql`${t.pointsBalance} >= 0`),
  ],
);

/** Append-only ledger. Never updated or deleted. */
export const stampTransactions = sqliteTable(
  "stamp_transactions",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    programId: text("program_id")
      .notNull()
      .references(() => loyaltyPrograms.id),
    cardId: text("card_id")
      .notNull()
      .references(() => customerCards.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    type: text("type", { enum: ["earn", "redeem", "adjust"] }).notNull(),
    points: integer("points").notNull(),
    channel: text("channel").$type<IssueChannel>().notNull(),
    actorUserId: text("actor_user_id").references(() => users.id),
    locationId: text("location_id").references(() => businessLocations.id),
    nfcTagId: text("nfc_tag_id"),
    rewardId: text("reward_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    // `${cardId}:${istDate}:${n}` for earns, so the daily limit is enforced by a UNIQUE index (race-safe).
    dailySlot: text("daily_slot"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("txn_idempotency_uq").on(t.idempotencyKey),
    uniqueIndex("txn_daily_slot_uq").on(t.dailySlot),
    index("txn_business_created_idx").on(t.businessId, t.createdAt),
    index("txn_card_created_idx").on(t.cardId, t.createdAt),
  ],
);

export const rewardRedemptions = sqliteTable(
  "reward_redemptions",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    programId: text("program_id")
      .notNull()
      .references(() => loyaltyPrograms.id),
    cardId: text("card_id")
      .notNull()
      .references(() => customerCards.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    rewardId: text("reward_id")
      .notNull()
      .references(() => rewards.id),
    rewardName: text("reward_name").notNull(),
    pointsUsed: integer("points_used").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id),
    locationId: text("location_id").references(() => businessLocations.id),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => stampTransactions.id),
    createdAt: createdAt(),
  },
  (t) => [index("redemptions_business_created_idx").on(t.businessId, t.createdAt)],
);

// ---------- QR & NFC ----------

export const qrCodes = sqliteTable(
  "qr_codes",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    locationId: text("location_id").references(() => businessLocations.id),
    code: text("code").notNull(),
    label: text("label").notNull(),
    status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
    scanCount: integer("scan_count").notNull().default(0),
    lastScannedAt: integer("last_scanned_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("qr_code_uq").on(t.code), index("qr_business_idx").on(t.businessId)],
);

export const nfcTags = sqliteTable(
  "nfc_tags",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    locationId: text("location_id").references(() => businessLocations.id),
    code: text("code").notNull(),
    label: text("label").notNull(),
    status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
    replacedById: text("replaced_by_id"),
    tapCount: integer("tap_count").notNull().default(0),
    lastTapAt: integer("last_tap_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("nfc_code_uq").on(t.code), index("nfc_business_idx").on(t.businessId)],
);

/** A customer's request to collect a point after tapping a tag. Staff must approve it. */
export const nfcSessions = sqliteTable(
  "nfc_sessions",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    tagId: text("tag_id").references(() => nfcTags.id),
    locationId: text("location_id").references(() => businessLocations.id),
    cardId: text("card_id")
      .notNull()
      .references(() => customerCards.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    channel: text("channel").$type<Extract<IssueChannel, "nfc_tag" | "nfc_phone">>().notNull(),
    shortCode: text("short_code").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected", "expired"] }).notNull().default("pending"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    transactionId: text("transaction_id"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("nfc_sessions_business_status_idx").on(t.businessId, t.status, t.createdAt)],
);

/** Analytics event stream (scans, taps, failures, review funnel). */
export const interactionEvents = sqliteTable(
  "interaction_events",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    type: text("type").notNull(),
    channel: text("channel"),
    outcome: text("outcome"),
    reason: text("reason"),
    customerId: text("customer_id"),
    cardId: text("card_id"),
    actorUserId: text("actor_user_id"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("events_business_type_created_idx").on(t.businessId, t.type, t.createdAt),
    // WhatsApp lists look up each customer's last message.
    index("events_business_customer_type_idx").on(t.businessId, t.customerId, t.type),
  ],
);

// ---------- Google review assistant ----------

export const googleReviewSettings = sqliteTable("google_review_settings", {
  businessId: text("business_id")
    .primaryKey()
    .references(() => businesses.id),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  profileName: text("profile_name"),
  reviewUrl: text("review_url"),
  category: text("category"),
  description: text("description"),
  services: text("services"),
  languages: text("languages", { mode: "json" })
    .$type<ReviewLanguage[]>()
    .notNull()
    .$defaultFn(() => ["en", "hi", "gu", "hinglish"]),
  /** Show the "Share your experience on Google" button under customers' loyalty cards. */
  showOnCard: integer("show_on_card", { mode: "boolean" }).notNull().default(true),
  updatedAt: updatedAt(),
});

export const REVIEW_KEYWORD_GROUPS = ["product", "service", "ambience", "location", "other"] as const;
export type ReviewKeywordGroup = (typeof REVIEW_KEYWORD_GROUPS)[number];

/** Owner-approved keywords customers can pick from when drafting a Google review. */
export const reviewKeywords = sqliteTable(
  "review_keywords",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    text: text("text").notNull(),
    /** Lower-cased, whitespace-collapsed text for de-duplication. */
    normalized: text("normalized").notNull(),
    group: text("group", { enum: REVIEW_KEYWORD_GROUPS }).notNull().default("other"),
    source: text("source", { enum: ["ai", "owner"] }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("review_keywords_business_text_uq").on(t.businessId, t.normalized)],
);

/** Messages from the public /support contact form; read by Super Admins. */
export const supportMessages = sqliteTable(
  "support_messages",
  {
    id: id(),
    name: text("name").notNull(),
    contact: text("contact").notNull(),
    topic: text("topic", { enum: ["shop_owner", "customer", "privacy", "other"] }).notNull(),
    businessName: text("business_name"),
    message: text("message").notNull(),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("support_messages_status_created_idx").on(t.status, t.createdAt)],
);

/** A customer card saved to Google Wallet (one Loyalty object per card). */
export const walletPasses = sqliteTable(
  "wallet_passes",
  {
    id: id(),
    cardId: text("card_id")
      .notNull()
      .references(() => customerCards.id),
    platform: text("platform", { enum: ["google"] }).notNull(),
    objectId: text("object_id").notNull(),
    classId: text("class_id").notNull(),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("wallet_passes_card_platform_uq").on(t.cardId, t.platform)],
);

export const reviewAssistantSessions = sqliteTable(
  "review_assistant_sessions",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    language: text("language").$type<ReviewLanguage>().notNull(),
    answers: text("answers", { mode: "json" }).$type<Record<string, string>>().notNull(),
    status: text("status", { enum: ["generated", "failed"] }).notNull(),
    errorCode: text("error_code"),
    generationCount: integer("generation_count").notNull().default(1),
    redirectedAt: integer("redirected_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("review_sessions_business_created_idx").on(t.businessId, t.createdAt)],
);

export const reviewDrafts = sqliteTable(
  "review_drafts",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => reviewAssistantSessions.id),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    style: text("style", { enum: ["short", "friendly", "detailed"] }).notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("review_drafts_session_idx").on(t.sessionId)],
);

export const aiUsageLogs = sqliteTable(
  "ai_usage_logs",
  {
    id: id(),
    businessId: text("business_id").references(() => businesses.id),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    feature: text("feature").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // Estimated cost in millionths of a US dollar, from configurable per-token prices.
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    status: text("status", { enum: ["success", "error"] }).notNull(),
    errorCode: text("error_code"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_business_created_idx").on(t.businessId, t.createdAt), index("ai_usage_created_idx").on(t.createdAt)],
);

// ---------- CRM & marketing ----------

export const customerConsents = sqliteTable(
  "customer_consents",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    channel: text("channel").$type<ConsentChannel>().notNull(),
    purpose: text("purpose").notNull().default("marketing"),
    status: text("status", { enum: ["granted", "withdrawn"] }).notNull(),
    source: text("source").notNull(),
    grantedAt: integer("granted_at", { mode: "timestamp_ms" }),
    withdrawnAt: integer("withdrawn_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("consent_business_customer_channel_uq").on(t.businessId, t.customerId, t.channel)],
);

export const marketingCampaigns = sqliteTable(
  "marketing_campaigns",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    type: text("type").$type<CampaignType>().notNull(),
    mode: text("mode", { enum: ["one_off", "automation"] }).notNull(),
    status: text("status", { enum: ["draft", "scheduled", "running", "active", "paused", "completed", "cancelled", "failed"] })
      .notNull()
      .default("draft"),
    channel: text("channel").$type<ConsentChannel>().notNull().default("whatsapp"),
    templateName: text("template_name").notNull(),
    templateLanguage: text("template_language").notNull().default("en"),
    templateParams: text("template_params", { mode: "json" }).$type<string[]>().notNull().$defaultFn(() => []),
    audience: text("audience", { mode: "json" })
      .$type<{ segment?: string; programId?: string }>()
      .notNull()
      .$defaultFn(() => ({})),
    settings: text("settings", { mode: "json" }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
    scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaigns_business_idx").on(t.businessId)],
);

/** Also serves as the outbound message outbox processed by the cron trigger. */
export const notificationLogs = sqliteTable(
  "notification_logs",
  {
    id: id(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    campaignId: text("campaign_id").references(() => marketingCampaigns.id),
    customerId: text("customer_id").references(() => customers.id),
    channel: text("channel").$type<ConsentChannel>().notNull(),
    recipient: text("recipient").notNull(),
    templateName: text("template_name").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["queued", "sending", "sent", "delivered", "read", "failed", "skipped"] }).notNull(),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }),
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("notif_provider_msg_uq").on(t.providerMessageId),
    uniqueIndex("notif_dedupe_uq").on(t.dedupeKey),
    index("notif_status_next_idx").on(t.status, t.nextAttemptAt),
    index("notif_business_created_idx").on(t.businessId, t.createdAt),
    index("notif_campaign_idx").on(t.campaignId),
  ],
);

// ---------- SaaS ----------

export const subscriptionPlans = sqliteTable(
  "subscription_plans",
  {
    id: id(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    pricePaise: integer("price_paise").notNull(),
    intervalDays: integer("interval_days").notNull().default(30),
    limits: text("limits", { mode: "json" }).$type<PlanLimits>().notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("plans_code_uq").on(t.code)],
);

/** One subscription per account (owner user); it covers all businesses that user owns. */
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    planId: text("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    status: text("status", { enum: ["active", "expired", "cancelled"] }).notNull(),
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("subscriptions_user_uq").on(t.userId)],
);

export const paymentTransactions = sqliteTable(
  "payment_transactions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    planId: text("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    provider: text("provider").notNull().default("razorpay"),
    orderId: text("order_id").notNull(),
    paymentId: text("payment_id"),
    amountPaise: integer("amount_paise").notNull(),
    currency: text("currency").notNull().default("INR"),
    status: text("status", { enum: ["created", "paid", "failed"] }).notNull(),
    failureReason: text("failure_reason"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payments_order_uq").on(t.orderId),
    uniqueIndex("payments_payment_uq").on(t.paymentId),
    index("payments_user_idx").on(t.userId),
  ],
);

export const platformSettings = sqliteTable("platform_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  updatedAt: updatedAt(),
});

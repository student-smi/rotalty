import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  businesses,
  customerCards,
  customerConsents,
  customers,
  customerSessions,
  googleReviewSettings,
  loyaltyPrograms,
  nfcSessions,
  nfcTags,
  rewards,
  stampTransactions,
} from "../db/schema";
import { endCustomerSession, requireCustomer, startCustomerSession } from "../middleware/customer";
import { AppError, badRequest, notFound } from "../lib/errors";
import { indianPhone, validate } from "../lib/validation";
import { assertTurnstile } from "../lib/turnstile";
import { createCardToken } from "../services/card-token";
import { isProgramLive } from "../services/loyalty-engine";
import { assertWithinLimit, getPlanForBusiness } from "../services/plans";
import { eventInsert } from "../services/events";
import { customerOtpRequired, otpMode, sendOtp, verifyOtp } from "../services/otp";
import { googleWalletSaveUrl, walletEnabled } from "../services/google-wallet";
import { logoUrl } from "./businesses";
import { CONSENT_CHANNELS } from "../../shared/domain";
import type { AppEnv } from "../types";

const NFC_REQUEST_TTL_MS = 5 * 60 * 1000;
const birthday = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use MM-DD")
  .nullish()
  .or(z.literal("").transform(() => null));

const joinSchema = z.object({
  slug: z.string().min(1).max(80),
  programId: z.string().uuid(),
  // Optional only for customers who already have a session; enforced in the handler.
  name: z.string().trim().min(2, "Enter your name").max(80).optional(),
  phone: indianPhone.optional(),
  email: z.email().nullish().or(z.literal("").transform(() => null)),
  birthday,
  whatsappConsent: z.boolean().default(false),
});

async function liveProgram(c: Context<AppEnv>, slug: string, programId: string) {
  const row = await c
    .get("db")
    .select({ business: businesses, program: loyaltyPrograms })
    .from(loyaltyPrograms)
    .innerJoin(businesses, eq(businesses.id, loyaltyPrograms.businessId))
    .where(and(eq(businesses.slug, slug), eq(loyaltyPrograms.id, programId), isNull(businesses.deletedAt), eq(businesses.status, "active")))
    .get();
  if (!row || !isProgramLive(row.program)) throw notFound("Loyalty program");
  return row;
}

function consentUpsert(c: Context<AppEnv>, businessId: string, customerId: string, channel: (typeof CONSENT_CHANNELS)[number], granted: boolean, source: string) {
  const now = new Date();
  const status = granted ? ("granted" as const) : ("withdrawn" as const);
  return c
    .get("db")
    .insert(customerConsents)
    .values({
      businessId,
      customerId,
      channel,
      status,
      source,
      grantedAt: granted ? now : null,
      withdrawnAt: granted ? null : now,
    })
    .onConflictDoUpdate({
      target: [customerConsents.businessId, customerConsents.customerId, customerConsents.channel],
      set: granted ? { status, source, grantedAt: now, withdrawnAt: null, updatedAt: now } : { status, source, withdrawnAt: now, updatedAt: now },
    });
}

async function cardViews(c: Context<AppEnv>, customerId: string, cardIds?: string[]) {
  const db = c.get("db");
  const rows = await db
    .select({ card: customerCards, program: loyaltyPrograms, business: businesses, review: googleReviewSettings })
    .from(customerCards)
    .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, customerCards.programId))
    .innerJoin(businesses, eq(businesses.id, customerCards.businessId))
    .leftJoin(googleReviewSettings, eq(googleReviewSettings.businessId, customerCards.businessId))
    .where(and(eq(customerCards.customerId, customerId), cardIds ? inArray(customerCards.id, cardIds) : undefined, isNull(businesses.deletedAt)))
    .orderBy(desc(customerCards.lastVisitAt), desc(customerCards.createdAt))
    .all();
  const rs = rows.length
    ? await db
        .select()
        .from(rewards)
        .where(and(inArray(rewards.programId, [...new Set(rows.map((r) => r.program.id))]), eq(rewards.isActive, true)))
        .orderBy(asc(rewards.pointsRequired))
        .all()
    : [];
  return rows.map(({ card, program, business, review }) => ({
    id: card.id,
    status: card.status,
    pointsBalance: card.pointsBalance,
    lifetimePoints: card.lifetimePoints,
    visits: card.visits,
    rewardsRedeemed: card.rewardsRedeemed,
    lastVisitAt: card.lastVisitAt,
    joinedAt: card.createdAt,
    business: {
      id: business.id,
      name: business.name,
      slug: business.slug,
      logoUrl: logoUrl(business.logoKey),
      active: business.status === "active",
      qrEnabled: business.qrEnabled,
      nfcTagEnabled: business.nfcTagEnabled,
      // Same for every customer: no rewards for reviewing and no filtering by happiness.
      reviewButton: !!(review?.enabled && review.reviewUrl && review.showOnCard && business.status === "active"),
    },
    googleWallet: walletEnabled(c.env),
    program: {
      id: program.id,
      name: program.name,
      description: program.description,
      stampIcon: program.stampIcon,
      stampsRequired: program.stampsRequired,
      endsAt: program.endsAt,
      terms: program.terms,
      live: isProgramLive(program),
    },
    rewards: rs
      .filter((r) => r.programId === program.id)
      .map((r) => ({ id: r.id, name: r.name, description: r.description, pointsRequired: r.pointsRequired, unlocked: card.pointsBalance >= r.pointsRequired })),
  }));
}

async function ownCard(c: Context<AppEnv>, cardId: string) {
  const card = await c
    .get("db")
    .select()
    .from(customerCards)
    .where(and(eq(customerCards.id, cardId), eq(customerCards.customerId, c.get("customer")!.id)))
    .get();
  if (!card) throw notFound("Card");
  return card;
}

export const customerRoutes = new Hono<AppEnv>()
  .get("/session", (c) => {
    const cu = c.get("customer");
    return c.json({
      customer: cu ? { id: cu.id, name: cu.name, phone: cu.phone, email: cu.email, birthday: cu.birthday, phoneVerified: cu.phoneVerified } : null,
      otpAvailable: otpMode(c.env) !== null,
      loginMode: customerOtpRequired(c.env) ? "otp" : "phone",
    });
  })

  .post("/join", validate("json", joinSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.get("db");
    const { business, program } = await liveProgram(c, input.slug, input.programId);
    let customer = c.get("customer");
    const signedIn = !!customer;

    if (!customer) {
      if (!input.name || !input.phone) {
        throw badRequest("Enter your name and mobile number", [
          ...(!input.name ? [{ path: "name", message: "Enter your name" }] : []),
          ...(!input.phone ? [{ path: "phone", message: "Enter your mobile number" }] : []),
        ]);
      }
      await assertTurnstile(c);
      const existing = await db.select().from(customers).where(and(eq(customers.phone, input.phone), isNull(customers.deletedAt))).get();
      if (existing && customerOtpRequired(c.env)) {
        // Never attach someone to an existing number's cards without proving ownership of that number.
        throw new AppError(409, "PHONE_REGISTERED", "This mobile number already has a loyalty account. Verify it with a one-time code to continue.", {
          otpAvailable: otpMode(c.env) !== null,
        });
      }
      // Phone-only mode: the number is the identity, so join adds the card to the existing customer.
      if (existing) customer = existing;
    }

    const existingCard = customer
      ? await db
          .select({ id: customerCards.id })
          .from(customerCards)
          .where(and(eq(customerCards.programId, program.id), eq(customerCards.customerId, customer.id)))
          .get()
      : null;
    if (existingCard) {
      if (!signedIn) await startCustomerSession(c, customer!.id);
      return c.json({ cardId: existingCard.id, created: false });
    }

    const alreadyCustomerHere =
      customer &&
      (await db
        .select({ id: customerCards.id })
        .from(customerCards)
        .where(and(eq(customerCards.businessId, business.id), eq(customerCards.customerId, customer.id)))
        .get());
    if (!alreadyCustomerHere) await assertWithinLimit(db, "customersPerBusiness", { businessId: business.id });

    const isNew = !customer;
    const customerId = customer?.id ?? crypto.randomUUID();
    const cardId = crypto.randomUUID();
    const statements: BatchItem<"sqlite">[] = [
      ...(isNew
        ? [db.insert(customers).values({ id: customerId, name: input.name!, phone: input.phone!, email: input.email, birthday: input.birthday })]
        : []),
      db.insert(customerCards).values({ id: cardId, businessId: business.id, programId: program.id, customerId }),
      ...(input.whatsappConsent ? [consentUpsert(c, business.id, customerId, "whatsapp", true, "join_form")] : []),
      eventInsert(db, { businessId: business.id, type: "card_joined", customerId, cardId }),
    ];
    try {
      await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    } catch (err) {
      if (String((err as Error)?.cause ?? err).includes("customers.phone")) {
        throw new AppError(409, "PHONE_REGISTERED", "This mobile number already has a loyalty account. Verify it to continue.");
      }
      throw err;
    }
    if (!signedIn) await startCustomerSession(c, customerId);
    return c.json({ cardId, created: true }, 201);
  })

  // Phone-only sign-in (used while CUSTOMER_OTP is off).
  .post("/login", validate("json", z.object({ phone: indianPhone })), async (c) => {
    if (customerOtpRequired(c.env)) throw new AppError(403, "OTP_REQUIRED", "Please verify your number with a one-time code");
    await assertTurnstile(c);
    const { phone } = c.req.valid("json");
    const customer = await c.get("db").select({ id: customers.id }).from(customers).where(and(eq(customers.phone, phone), isNull(customers.deletedAt))).get();
    if (!customer) throw new AppError(404, "NO_CARDS", "We couldn't find any loyalty cards for this number. Scan the QR code at a shop to join.");
    await startCustomerSession(c, customer.id);
    return c.json({ ok: true });
  })

  .post("/otp/send", validate("json", z.object({ phone: indianPhone })), async (c) => {
    await assertTurnstile(c);
    const { phone } = c.req.valid("json");
    const exists = await c.get("db").select({ id: customers.id }).from(customers).where(and(eq(customers.phone, phone), isNull(customers.deletedAt))).get();
    // Respond identically whether or not the number exists, so this can't be used to discover customers.
    if (exists) await sendOtp(c.env, c.get("db"), phone);
    return c.json({ sent: true });
  })

  .post(
    "/otp/verify",
    validate("json", z.object({ phone: indianPhone, code: z.string().regex(/^\d{4,8}$/, "Enter the code from the SMS") })),
    async (c) => {
      const { phone, code } = c.req.valid("json");
      const db = c.get("db");
      const ok = await verifyOtp(c.env, db, phone, code);
      if (!ok) throw new AppError(400, "OTP_INVALID", "That code is incorrect or has expired");
      const customer = await db.select().from(customers).where(and(eq(customers.phone, phone), isNull(customers.deletedAt))).get();
      if (!customer) throw notFound("Account");
      await db.update(customers).set({ phoneVerified: true }).where(eq(customers.id, customer.id));
      await startCustomerSession(c, customer.id);
      return c.json({ ok: true });
    },
  )

  .post("/logout", async (c) => {
    await endCustomerSession(c);
    return c.json({ ok: true });
  })

  .get("/cards", requireCustomer, async (c) => c.json({ cards: await cardViews(c, c.get("customer")!.id) }))

  .get("/cards/:cardId", requireCustomer, async (c) => {
    const [card] = await cardViews(c, c.get("customer")!.id, [c.req.param("cardId")]);
    if (!card) throw notFound("Card");
    const history = await c
      .get("db")
      .select({ id: stampTransactions.id, type: stampTransactions.type, points: stampTransactions.points, channel: stampTransactions.channel, createdAt: stampTransactions.createdAt })
      .from(stampTransactions)
      .where(eq(stampTransactions.cardId, card.id))
      .orderBy(desc(stampTransactions.createdAt))
      .limit(50)
      .all();
    return c.json({ card, history });
  })

  /** Rotating, signed, single-use QR payload that staff scan to issue a point. */
  /** "Add to Google Wallet": returns a signed save link for the customer's own card. */
  .post("/cards/:cardId/google-wallet", requireCustomer, async (c) => {
    const card = await ownCard(c, c.req.param("cardId"));
    if (card.status !== "active") throw new AppError(409, "CARD_BLOCKED", "This card is blocked");
    return c.json({ saveUrl: await googleWalletSaveUrl(c.env, c.get("db"), card.id) });
  })

  .post("/cards/:cardId/token", requireCustomer, async (c) => {
    const card = await ownCard(c, c.req.param("cardId"));
    if (card.status !== "active") throw new AppError(409, "CARD_BLOCKED", "This card is blocked");
    return c.json(await createCardToken(c.env.BETTER_AUTH_SECRET, card.id));
  })

  .post(
    "/nfc-requests",
    requireCustomer,
    validate("json", z.object({ tagCode: z.string().min(6).max(40), cardId: z.string().uuid() })),
    async (c) => {
      const { tagCode, cardId } = c.req.valid("json");
      const db = c.get("db");
      const card = await ownCard(c, cardId);
      const tag = await db
        .select({ tag: nfcTags, business: businesses })
        .from(nfcTags)
        .innerJoin(businesses, eq(businesses.id, nfcTags.businessId))
        .where(eq(nfcTags.code, tagCode))
        .get();
      if (!tag || tag.tag.status !== "active" || !tag.business.nfcTagEnabled || tag.business.status !== "active") {
        throw new AppError(400, "TAG_INVALID", "This NFC tag is no longer active. Show your card QR to staff instead.");
      }
      if (tag.tag.businessId !== card.businessId) throw badRequest("This card belongs to a different business");
      const { plan } = await getPlanForBusiness(db, card.businessId);
      if (!plan.limits.nfc) throw new AppError(403, "NFC_UNAVAILABLE", "NFC collection isn't available here. Show your card QR to staff.");

      const pending = await db
        .select()
        .from(nfcSessions)
        .where(and(eq(nfcSessions.cardId, card.id), eq(nfcSessions.status, "pending"), gt(nfcSessions.expiresAt, new Date())))
        .get();
      if (pending) return c.json({ request: { id: pending.id, shortCode: pending.shortCode, expiresAt: pending.expiresAt, status: pending.status } });

      const id = crypto.randomUUID();
      const shortCode = String(crypto.getRandomValues(new Uint16Array(1))[0]! % 10000).padStart(4, "0");
      const expiresAt = new Date(Date.now() + NFC_REQUEST_TTL_MS);
      await db.batch([
        db.insert(nfcSessions).values({
          id,
          businessId: card.businessId,
          tagId: tag.tag.id,
          locationId: tag.tag.locationId,
          cardId: card.id,
          customerId: card.customerId,
          channel: "nfc_tag",
          shortCode,
          expiresAt,
        }),
        eventInsert(db, { businessId: card.businessId, type: "nfc_request", channel: "nfc_tag", customerId: card.customerId, cardId: card.id }),
      ]);
      return c.json({ request: { id, shortCode, expiresAt, status: "pending" } }, 201);
    },
  )

  .get("/nfc-requests/:id", requireCustomer, async (c) => {
    const row = await c
      .get("db")
      .select()
      .from(nfcSessions)
      .where(and(eq(nfcSessions.id, c.req.param("id")), eq(nfcSessions.customerId, c.get("customer")!.id)))
      .get();
    if (!row) throw notFound("Request");
    const status = row.status === "pending" && row.expiresAt.getTime() < Date.now() ? "expired" : row.status;
    return c.json({ request: { id: row.id, shortCode: row.shortCode, status, expiresAt: row.expiresAt, failureReason: row.failureReason } });
  })

  .post("/device-unsupported", requireCustomer, validate("json", z.object({ businessId: z.string().uuid(), feature: z.string().max(40) })), async (c) => {
    const { businessId, feature } = c.req.valid("json");
    const card = await c
      .get("db")
      .select({ id: customerCards.id })
      .from(customerCards)
      .where(and(eq(customerCards.businessId, businessId), eq(customerCards.customerId, c.get("customer")!.id)))
      .get();
    if (card) {
      await eventInsert(c.get("db"), { businessId, type: "device_unsupported", channel: "nfc", reason: feature, customerId: c.get("customer")!.id });
    }
    return c.json({ ok: true });
  })

  .patch(
    "/me",
    requireCustomer,
    validate("json", z.object({ name: z.string().trim().min(2).max(80).optional(), email: z.email().nullish().or(z.literal("").transform(() => null)), birthday })),
    async (c) => {
      const input = c.req.valid("json");
      await c.get("db").update(customers).set(input).where(eq(customers.id, c.get("customer")!.id));
      return c.json({ ok: true });
    },
  )

  .get("/consents", requireCustomer, async (c) => {
    const customerId = c.get("customer")!.id;
    const db = c.get("db");
    const bizRows = await db
      .selectDistinct({ id: businesses.id, name: businesses.name })
      .from(customerCards)
      .innerJoin(businesses, eq(businesses.id, customerCards.businessId))
      .where(eq(customerCards.customerId, customerId))
      .all();
    const consents = await db.select().from(customerConsents).where(eq(customerConsents.customerId, customerId)).all();
    return c.json({
      businesses: bizRows.map((b) => ({
        businessId: b.id,
        name: b.name,
        channels: Object.fromEntries(
          CONSENT_CHANNELS.map((ch) => [ch, consents.find((x) => x.businessId === b.id && x.channel === ch)?.status === "granted"]),
        ),
      })),
    });
  })

  .put(
    "/consents",
    requireCustomer,
    validate("json", z.object({ businessId: z.string().uuid(), channel: z.enum(CONSENT_CHANNELS), granted: z.boolean() })),
    async (c) => {
      const { businessId, channel, granted } = c.req.valid("json");
      const customerId = c.get("customer")!.id;
      const hasCard = await c
        .get("db")
        .select({ id: customerCards.id })
        .from(customerCards)
        .where(and(eq(customerCards.businessId, businessId), eq(customerCards.customerId, customerId)))
        .get();
      if (!hasCard) throw notFound("Business");
      await consentUpsert(c, businessId, customerId, channel, granted, "customer_settings");
      return c.json({ ok: true });
    },
  )

  /** Right to erasure (DPDP Act): removes personal data; anonymous ledger rows remain for the business's records. */
  .delete("/me", requireCustomer, async (c) => {
    const db = c.get("db");
    const id = c.get("customer")!.id;
    const now = new Date();
    await db.batch([
      db.update(customers).set({ name: "Deleted customer", phone: null, email: null, birthday: null, phoneVerified: false, deletedAt: now }).where(eq(customers.id, id)),
      db
        .update(customerConsents)
        .set({ status: "withdrawn", withdrawnAt: now, source: "account_deleted" })
        .where(eq(customerConsents.customerId, id)),
      db.delete(customerSessions).where(eq(customerSessions.customerId, id)),
    ]);
    await endCustomerSession(c);
    return c.json({ ok: true });
  });

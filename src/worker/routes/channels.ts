import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, desc, eq, lt } from "drizzle-orm";
import { businesses, customers, nfcSessions, nfcTags, qrCodes, users } from "../db/schema";
import { requireBusiness } from "../middleware/auth";
import { auditInsert } from "../lib/audit";
import { AppError, badRequest, notFound } from "../lib/errors";
import { validate } from "../lib/validation";
import { publicOrigin, resolveLocation, shortCode } from "../lib/scope";
import { assertFeature, getPlanForBusiness } from "../services/plans";
import type { AppEnv } from "../types";

const labelSchema = z.object({ label: z.string().trim().min(2).max(60), locationId: z.string().uuid().nullish() });

const qrUrl = (env: Env, code: string) => `${publicOrigin(env)}/q/${code}`;
const tagUrl = (env: Env, code: string) => `${publicOrigin(env)}/t/${code}`;

/** Owners may assign any location; this reuses the same validation as staff location checks. */
async function ownedLocation(c: Context<AppEnv>, locationId: string | null | undefined) {
  if (!locationId) return null;
  return resolveLocation(c, locationId);
}

export const channelRoutes = new Hono<AppEnv>()
  .get("/:businessId/channels", requireBusiness({ permission: "loyalty.manage" }), async (c) => {
    const db = c.get("db");
    const { business } = c.get("membership");
    const [{ plan }, qrs, tags] = await Promise.all([
      getPlanForBusiness(db, business.id),
      db.select().from(qrCodes).where(eq(qrCodes.businessId, business.id)).orderBy(desc(qrCodes.createdAt)).all(),
      db.select().from(nfcTags).where(eq(nfcTags.businessId, business.id)).orderBy(desc(nfcTags.createdAt)).all(),
    ]);
    return c.json({
      settings: { qrEnabled: business.qrEnabled, nfcTagEnabled: business.nfcTagEnabled, nfcPhoneEnabled: business.nfcPhoneEnabled },
      capabilities: {
        nfcIncludedInPlan: plan.limits.nfc,
        // Browsers cannot emulate an NFC card, so true phone-to-phone NFC needs a native Android (HCE) app.
        nfcPhoneSupported: false,
      },
      businessPageUrl: `${publicOrigin(c.env)}/s/${business.slug}`,
      qrCodes: qrs.map((q) => ({ ...q, url: qrUrl(c.env, q.code) })),
      nfcTags: tags.map((t) => ({ ...t, url: tagUrl(c.env, t.code) })),
    });
  })

  .patch(
    "/:businessId/channels",
    requireBusiness({ permission: "loyalty.manage" }),
    validate("json", z.object({ qrEnabled: z.boolean().optional(), nfcTagEnabled: z.boolean().optional(), nfcPhoneEnabled: z.boolean().optional() })),
    async (c) => {
      const input = c.req.valid("json");
      const db = c.get("db");
      const { business } = c.get("membership");
      if (input.nfcPhoneEnabled) {
        throw new AppError(
          400,
          "NFC_PHONE_UNSUPPORTED",
          "Phone-to-phone NFC needs a native Android app and isn't available in the web version. Use QR or NFC tags.",
        );
      }
      if (input.nfcTagEnabled) await assertFeature(db, business.id, "nfc");
      await db.batch([
        db.update(businesses).set(input).where(eq(businesses.id, business.id)),
        auditInsert(c, { businessId: business.id, action: "channels.updated", entityType: "business", entityId: business.id, metadata: input }),
      ]);
      return c.json({ ok: true });
    },
  )

  .post("/:businessId/qr-codes", requireBusiness({ permission: "loyalty.manage" }), validate("json", labelSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.get("db");
    const { business } = c.get("membership");
    const id = crypto.randomUUID();
    const code = shortCode();
    await db.batch([
      db.insert(qrCodes).values({ id, businessId: business.id, code, label: input.label, locationId: await ownedLocation(c, input.locationId) }),
      auditInsert(c, { businessId: business.id, action: "qr.created", entityType: "qr_code", entityId: id }),
    ]);
    return c.json({ qrCode: { id, code, label: input.label, url: qrUrl(c.env, code) } }, 201);
  })

  .post("/:businessId/qr-codes/:qrId/:action{revoke|rotate}", requireBusiness({ permission: "loyalty.manage" }), async (c) => {
    const db = c.get("db");
    const { business } = c.get("membership");
    const scope = and(eq(qrCodes.id, c.req.param("qrId")), eq(qrCodes.businessId, business.id));
    const qr = await db.select().from(qrCodes).where(scope).get();
    if (!qr) throw notFound("QR code");
    if (qr.status === "revoked") throw badRequest("This QR code is already revoked");
    const action = c.req.param("action");
    const newId = crypto.randomUUID();
    const newCode = shortCode();
    await db.batch([
      db.update(qrCodes).set({ status: "revoked", revokedAt: new Date() }).where(scope),
      ...(action === "rotate"
        ? [db.insert(qrCodes).values({ id: newId, businessId: business.id, code: newCode, label: qr.label, locationId: qr.locationId })]
        : []),
      auditInsert(c, { businessId: business.id, action: `qr.${action}d`, entityType: "qr_code", entityId: qr.id }),
    ]);
    return c.json(action === "rotate" ? { qrCode: { id: newId, code: newCode, label: qr.label, url: qrUrl(c.env, newCode) } } : { ok: true });
  })

  .post("/:businessId/nfc-tags", requireBusiness({ permission: "loyalty.manage" }), validate("json", labelSchema), async (c) => {
    const input = c.req.valid("json");
    const db = c.get("db");
    const { business } = c.get("membership");
    await assertFeature(db, business.id, "nfc");
    const id = crypto.randomUUID();
    const code = shortCode(12);
    await db.batch([
      db.insert(nfcTags).values({ id, businessId: business.id, code, label: input.label, locationId: await ownedLocation(c, input.locationId) }),
      auditInsert(c, { businessId: business.id, action: "nfc_tag.registered", entityType: "nfc_tag", entityId: id }),
    ]);
    return c.json({ nfcTag: { id, code, label: input.label, url: tagUrl(c.env, code) } }, 201);
  })

  .post("/:businessId/nfc-tags/:tagId/:action{revoke|replace}", requireBusiness({ permission: "loyalty.manage" }), async (c) => {
    const db = c.get("db");
    const { business } = c.get("membership");
    const scope = and(eq(nfcTags.id, c.req.param("tagId")), eq(nfcTags.businessId, business.id));
    const tag = await db.select().from(nfcTags).where(scope).get();
    if (!tag) throw notFound("NFC tag");
    if (tag.status === "revoked") throw badRequest("This tag is already revoked");
    const action = c.req.param("action");
    if (action === "replace") await assertFeature(db, business.id, "nfc");
    const newId = crypto.randomUUID();
    const newCode = shortCode(12);
    await db.batch([
      db
        .update(nfcTags)
        .set({ status: "revoked", revokedAt: new Date(), replacedById: action === "replace" ? newId : null })
        .where(scope),
      ...(action === "replace"
        ? [db.insert(nfcTags).values({ id: newId, businessId: business.id, code: newCode, label: tag.label, locationId: tag.locationId })]
        : []),
      auditInsert(c, { businessId: business.id, action: `nfc_tag.${action}d`, entityType: "nfc_tag", entityId: tag.id }),
    ]);
    return c.json(action === "replace" ? { nfcTag: { id: newId, code: newCode, label: tag.label, url: tagUrl(c.env, newCode) } } : { ok: true });
  })

  .get(
    "/:businessId/nfc-history",
    requireBusiness({ permission: "loyalty.manage" }),
    validate("query", z.object({ before: z.coerce.number().int().optional() })),
    async (c) => {
      const { before } = c.req.valid("query");
      const { business } = c.get("membership");
      const rows = await c
        .get("db")
        .select({
          id: nfcSessions.id,
          channel: nfcSessions.channel,
          status: nfcSessions.status,
          failureReason: nfcSessions.failureReason,
          createdAt: nfcSessions.createdAt,
          resolvedAt: nfcSessions.resolvedAt,
          customerName: customers.name,
          tagLabel: nfcTags.label,
          staffName: users.name,
        })
        .from(nfcSessions)
        .innerJoin(customers, eq(customers.id, nfcSessions.customerId))
        .leftJoin(nfcTags, eq(nfcTags.id, nfcSessions.tagId))
        .leftJoin(users, eq(users.id, nfcSessions.resolvedByUserId))
        .where(and(eq(nfcSessions.businessId, business.id), before ? lt(nfcSessions.createdAt, new Date(before)) : undefined))
        .orderBy(desc(nfcSessions.createdAt))
        .limit(51)
        .all();
      const page = rows.slice(0, 50);
      return c.json({ history: page, nextBefore: rows.length > 50 ? page.at(-1)!.createdAt.getTime() : null });
    },
  );

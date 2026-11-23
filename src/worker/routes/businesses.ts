import { Hono } from "hono";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { businesses, businessLocations, businessStaff, googleReviewSettings, media } from "../db/schema";
import { requireBusiness, requireUser } from "../middleware/auth";
import { auditInsert } from "../lib/audit";
import { badRequest } from "../lib/errors";
import { addressFields, indianPhone, optionalText, validate } from "../lib/validation";
import { assertWithinLimit } from "../services/plans";
import { googleReviewUrl, PLACE_ID_RE } from "../services/places";
import { BUSINESS_CATEGORIES } from "../../shared/permissions";
import type { AppEnv } from "../types";
import type { DB } from "../db/client";

/** `logoKey` holds the id of a row in the `media` table. */
export const logoUrl = (key: string | null) => (key ? `/api/public/media/${key}` : null);

const businessFields = {
  name: z.string().trim().min(2, "Business name is too short").max(80),
  category: z.enum(BUSINESS_CATEGORIES),
  description: optionalText(500),
  phone: indianPhone.nullish().or(z.literal("").transform(() => null)),
  email: z.email("Enter a valid email").nullish().or(z.literal("").transform(() => null)),
  ...addressFields,
  googlePlaceId: z.string().regex(PLACE_ID_RE, "Invalid Google place").nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
};

const createSchema = z.object(businessFields);
const updateSchema = z.object(businessFields).partial();

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "business";
}

async function uniqueSlug(db: DB, name: string) {
  const base = slugify(name);
  const taken = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, base)).get();
  if (!taken) return base;
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

function serializeBusiness(b: typeof businesses.$inferSelect) {
  const { logoKey, deletedAt: _deleted, ...rest } = b;
  return { ...rest, logoUrl: logoUrl(logoKey) };
}

const LOGO_MAGIC: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
};
// Logos live in D1, so keep them small. The client resizes images before upload.
const MAX_LOGO_BYTES = 300 * 1024;

export const businessRoutes = new Hono<AppEnv>()
  .post("/", requireUser, validate("json", createSchema), async (c) => {
    const input = c.req.valid("json");
    const user = c.get("user")!;
    const db = c.get("db");
    await assertWithinLimit(db, "businesses", { userId: user.id });
    const businessId = crypto.randomUUID();
    const slug = await uniqueSlug(db, input.name);

    await db.batch([
      db.insert(businesses).values({ id: businessId, ownerUserId: user.id, slug, ...input }),
      db.insert(businessStaff).values({ businessId, userId: user.id, role: "owner", permissions: null }),
      db.insert(businessLocations).values({
        businessId,
        name: "Main location",
        addressLine: input.addressLine,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        phone: input.phone,
      }),
      auditInsert(c, { businessId, action: "business.created", entityType: "business", entityId: businessId }),
      // Picked from Google search: pre-fill the review link so the review helper is one click away.
      ...(input.googlePlaceId ? [db.insert(googleReviewSettings).values({ businessId, profileName: input.name, reviewUrl: googleReviewUrl(input.googlePlaceId) })] : []),
    ]);

    const created = await db.select().from(businesses).where(eq(businesses.id, businessId)).get();
    return c.json({ business: serializeBusiness(created!) }, 201);
  })

  .get("/:businessId", requireBusiness({ allowSuspended: true }), (c) => {
    const m = c.get("membership");
    return c.json({
      business: serializeBusiness(m.business),
      membership: { role: m.role, permissions: m.permissions, locationId: m.locationId },
    });
  })

  .patch(
    "/:businessId",
    requireBusiness({ permission: "business.manage" }),
    validate("json", updateSchema),
    async (c) => {
      const input = c.req.valid("json");
      if (Object.keys(input).length === 0) throw badRequest("Nothing to update");
      const db = c.get("db");
      const { business } = c.get("membership");
      const fillReviewLink =
        input.googlePlaceId && input.googlePlaceId !== business.googlePlaceId
          ? [
              db
                .insert(googleReviewSettings)
                .values({ businessId: business.id, profileName: input.name ?? business.name, reviewUrl: googleReviewUrl(input.googlePlaceId) })
                .onConflictDoUpdate({
                  target: googleReviewSettings.businessId,
                  set: { reviewUrl: googleReviewUrl(input.googlePlaceId), updatedAt: new Date() },
                  setWhere: isNull(googleReviewSettings.reviewUrl),
                }),
            ]
          : [];
      await db.batch([
        db.update(businesses).set(input).where(eq(businesses.id, business.id)),
        auditInsert(c, {
          businessId: business.id,
          action: "business.updated",
          entityType: "business",
          entityId: business.id,
          metadata: { fields: Object.keys(input) },
        }),
        ...fillReviewLink,
      ]);
      const updated = await db.select().from(businesses).where(eq(businesses.id, business.id)).get();
      return c.json({ business: serializeBusiness(updated!) });
    },
  )

  .post("/:businessId/logo", requireBusiness({ permission: "business.manage" }), async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("logo");
    if (!(file instanceof File)) throw badRequest("Attach an image in the 'logo' field");
    const magic = LOGO_MAGIC[file.type];
    if (!magic) throw badRequest("Logo must be a PNG, JPEG or WebP image");
    if (file.size > MAX_LOGO_BYTES) throw badRequest("Logo must be 300 KB or smaller");

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!magic.every((b, i) => bytes[i] === b)) throw badRequest("File content does not match its image type");

    const db = c.get("db");
    const { business } = c.get("membership");
    const mediaId = crypto.randomUUID();
    await db.batch([
      db.insert(media).values({ id: mediaId, businessId: business.id, contentType: file.type, size: bytes.byteLength, data: Buffer.from(bytes) }),
      db.update(businesses).set({ logoKey: mediaId }).where(eq(businesses.id, business.id)),
      ...(business.logoKey ? [db.delete(media).where(and(eq(media.id, business.logoKey), eq(media.businessId, business.id)))] : []),
      auditInsert(c, { businessId: business.id, action: "business.logo_updated", entityType: "business", entityId: business.id }),
    ]);
    return c.json({ logoUrl: logoUrl(mediaId) });
  });

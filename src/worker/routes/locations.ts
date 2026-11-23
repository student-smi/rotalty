import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { businessLocations } from "../db/schema";
import { requireBusiness } from "../middleware/auth";
import { auditInsert } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { addressFields, indianPhone, validate } from "../lib/validation";
import { assertWithinLimit } from "../services/plans";
import type { AppEnv } from "../types";

const locationFields = {
  name: z.string().trim().min(2).max(80),
  phone: indianPhone.nullish().or(z.literal("").transform(() => null)),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  isActive: z.boolean().optional(),
  ...addressFields,
};

const PATH = "/:businessId/locations";

export const locationRoutes = new Hono<AppEnv>()
  .get(PATH, requireBusiness(), async (c) => {
    const { business } = c.get("membership");
    const rows = await c
      .get("db")
      .select()
      .from(businessLocations)
      .where(and(eq(businessLocations.businessId, business.id), isNull(businessLocations.deletedAt)))
      .orderBy(asc(businessLocations.createdAt))
      .all();
    return c.json({ locations: rows });
  })

  .post(PATH, requireBusiness({ permission: "locations.manage" }), validate("json", z.object(locationFields)), async (c) => {
    const input = c.req.valid("json");
    const db = c.get("db");
    const { business } = c.get("membership");
    await assertWithinLimit(db, "locationsPerBusiness", { businessId: business.id });
    const id = crypto.randomUUID();
    await db.batch([
      db.insert(businessLocations).values({ id, businessId: business.id, ...input }),
      auditInsert(c, { businessId: business.id, action: "location.created", entityType: "location", entityId: id }),
    ]);
    const location = await db.select().from(businessLocations).where(eq(businessLocations.id, id)).get();
    return c.json({ location }, 201);
  })

  .patch(
    `${PATH}/:locationId`,
    requireBusiness({ permission: "locations.manage" }),
    validate("json", z.object(locationFields).partial()),
    async (c) => {
      const input = c.req.valid("json");
      if (Object.keys(input).length === 0) throw badRequest("Nothing to update");
      const db = c.get("db");
      const { business } = c.get("membership");
      const scope = and(
        eq(businessLocations.id, c.req.param("locationId")),
        eq(businessLocations.businessId, business.id),
        isNull(businessLocations.deletedAt),
      );
      const existing = await db.select({ id: businessLocations.id }).from(businessLocations).where(scope).get();
      if (!existing) throw notFound("Location");
      await db.batch([
        db.update(businessLocations).set(input).where(scope),
        auditInsert(c, {
          businessId: business.id,
          action: "location.updated",
          entityType: "location",
          entityId: existing.id,
          metadata: { fields: Object.keys(input) },
        }),
      ]);
      const location = await db.select().from(businessLocations).where(eq(businessLocations.id, existing.id)).get();
      return c.json({ location });
    },
  )

  .delete(`${PATH}/:locationId`, requireBusiness({ permission: "locations.manage" }), async (c) => {
    const db = c.get("db");
    const { business } = c.get("membership");
    const active = await db
      .select({ id: businessLocations.id })
      .from(businessLocations)
      .where(and(eq(businessLocations.businessId, business.id), isNull(businessLocations.deletedAt)))
      .all();
    const target = active.find((l) => l.id === c.req.param("locationId"));
    if (!target) throw notFound("Location");
    if (active.length === 1) throw badRequest("A business needs at least one location");
    await db.batch([
      db
        .update(businessLocations)
        .set({ deletedAt: new Date(), isActive: false })
        .where(and(eq(businessLocations.id, target.id), eq(businessLocations.businessId, business.id))),
      auditInsert(c, { businessId: business.id, action: "location.deleted", entityType: "location", entityId: target.id }),
    ]);
    return c.json({ ok: true });
  });

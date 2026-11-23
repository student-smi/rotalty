import { createMiddleware } from "hono/factory";
import { and, eq, isNull } from "drizzle-orm";
import { createAuth } from "../auth";
import { createDb } from "../db/client";
import { businesses, businessStaff } from "../db/schema";
import { AppError, forbidden, notFound, unauthorized } from "../lib/errors";
import { effectivePermissions, type Permission } from "../../shared/permissions";
import type { AppEnv } from "../types";

export const withContext = createMiddleware<AppEnv>(async (c, next) => {
  const db = createDb(c.env.DB);
  const auth = createAuth(c.env, db);
  c.set("db", db);
  c.set("auth", auth);
  const data = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", data?.user ?? null);
  c.set("session", data?.session ?? null);
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) throw unauthorized();
  await next();
});

export const requireSuperAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) throw unauthorized();
  if (user.role !== "super_admin") throw forbidden();
  await next();
});

/**
 * Resolves the caller's membership in the `:businessId` route param and enforces a permission.
 * Every business-scoped handler must read the business id from `c.var.membership`, never from the request body.
 */
export function requireBusiness(opts: { permission?: Permission; allowSuspended?: boolean } = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) throw unauthorized();
    const businessId = c.req.param("businessId");
    if (!businessId) throw notFound("Business");

    const row = await c
      .get("db")
      .select({ staff: businessStaff, business: businesses })
      .from(businessStaff)
      .innerJoin(businesses, eq(businesses.id, businessStaff.businessId))
      .where(
        and(
          eq(businessStaff.businessId, businessId),
          eq(businessStaff.userId, user.id),
          eq(businessStaff.status, "active"),
          isNull(businesses.deletedAt),
        ),
      )
      .get();

    // Same response for "doesn't exist" and "not a member" so business ids can't be probed.
    if (!row) throw notFound("Business");
    if (row.business.status === "suspended" && !opts.allowSuspended) {
      throw new AppError(403, "BUSINESS_SUSPENDED", "This business account is suspended. Contact support.");
    }

    const permissions = effectivePermissions(row.staff.role, row.staff.permissions);
    if (opts.permission && !permissions.includes(opts.permission)) throw forbidden();

    c.set("membership", {
      staffId: row.staff.id,
      role: row.staff.role,
      permissions,
      locationId: row.staff.locationId,
      business: row.business,
    });
    await next();
  });
}

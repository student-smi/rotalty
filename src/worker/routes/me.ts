import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { businesses, businessStaff } from "../db/schema";
import { requireUser } from "../middleware/auth";
import { effectivePermissions } from "../../shared/permissions";
import type { AppEnv } from "../types";
import { logoUrl } from "./businesses";

export const meRoutes = new Hono<AppEnv>().get("/", requireUser, async (c) => {
  const user = c.get("user")!;
  const rows = await c
    .get("db")
    .select({ staff: businessStaff, business: businesses })
    .from(businessStaff)
    .innerJoin(businesses, eq(businesses.id, businessStaff.businessId))
    .where(and(eq(businessStaff.userId, user.id), eq(businessStaff.status, "active"), isNull(businesses.deletedAt)))
    .all();

  return c.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    memberships: rows.map(({ staff, business }) => ({
      businessId: business.id,
      name: business.name,
      slug: business.slug,
      category: business.category,
      logoUrl: logoUrl(business.logoKey),
      businessStatus: business.status,
      role: staff.role,
      permissions: effectivePermissions(staff.role, staff.permissions),
    })),
  });
});

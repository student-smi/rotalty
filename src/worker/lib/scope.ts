import type { Context } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { businessLocations } from "../db/schema";
import { badRequest, forbidden } from "./errors";
import type { AppEnv } from "../types";
import type { Permission } from "../../shared/permissions";

/** Staff pinned to a location always act at that location; others may pick any location of the business. */
export async function resolveLocation(c: Context<AppEnv>, requested: string | null | undefined): Promise<string | null> {
  const m = c.get("membership");
  if (m.locationId) return m.locationId;
  if (!requested) return null;
  const loc = await c
    .get("db")
    .select({ id: businessLocations.id })
    .from(businessLocations)
    .where(and(eq(businessLocations.id, requested), eq(businessLocations.businessId, m.business.id), isNull(businessLocations.deletedAt)))
    .get();
  if (!loc) throw badRequest("Location does not belong to this business");
  return loc.id;
}

export function requireAnyPermission(c: Context<AppEnv>, ...perms: Permission[]) {
  const have = c.get("membership").permissions;
  if (!perms.some((p) => have.includes(p))) throw forbidden();
}

const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/** Unambiguous short code for printed QR / NFC URLs (31^10 ≈ 8e14 combinations). */
export function shortCode(length = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function publicOrigin(env: Env) {
  return new URL(env.BETTER_AUTH_URL).origin;
}

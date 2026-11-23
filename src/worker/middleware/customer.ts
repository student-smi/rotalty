import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, gt, isNull } from "drizzle-orm";
import { customers, customerSessions } from "../db/schema";
import { AppError } from "../lib/errors";
import { randomToken, sha256Hex } from "../lib/crypto";
import type { AppEnv } from "../types";

const COOKIE = "lr_customer";
const TTL_MS = 365 * 24 * 60 * 60 * 1000;

function cookieOptions(c: Context<AppEnv>) {
  return {
    httpOnly: true,
    secure: c.env.APP_ENV === "production",
    sameSite: "Lax" as const,
    path: "/",
  };
}

/** Customers don't use Better Auth: they get a lightweight, long-lived device session tied to their phone number. */
export async function startCustomerSession(c: Context<AppEnv>, customerId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + TTL_MS);
  await c
    .get("db")
    .insert(customerSessions)
    .values({ customerId, tokenHash: await sha256Hex(token), expiresAt, userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null });
  setCookie(c, COOKIE, token, { ...cookieOptions(c), expires: expiresAt });
}

export async function endCustomerSession(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE);
  if (token) await c.get("db").delete(customerSessions).where(eq(customerSessions.tokenHash, await sha256Hex(token)));
  deleteCookie(c, COOKIE, cookieOptions(c));
}

export const loadCustomer = createMiddleware<AppEnv>(async (c, next) => {
  c.set("customer", null);
  const token = getCookie(c, COOKIE);
  if (token && token.length < 100) {
    const row = await c
      .get("db")
      .select({ customer: customers })
      .from(customerSessions)
      .innerJoin(customers, eq(customers.id, customerSessions.customerId))
      .where(and(eq(customerSessions.tokenHash, await sha256Hex(token)), gt(customerSessions.expiresAt, new Date()), isNull(customers.deletedAt)))
      .get();
    c.set("customer", row?.customer ?? null);
  }
  await next();
});

export const requireCustomer = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("customer")) throw new AppError(401, "CUSTOMER_UNAUTHORIZED", "Open your loyalty card first");
  await next();
});

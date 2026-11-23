import { createMiddleware } from "hono/factory";
import { AppError } from "../lib/errors";
import type { AppEnv } from "../types";

export function rateLimit(pick: (env: Env) => RateLimit, scope: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const { success } = await pick(c.env).limit({ key: `${scope}:${ip}` });
    if (!success) throw new AppError(429, "RATE_LIMITED", "Too many requests. Please wait a minute and try again.");
    await next();
  });
}

import type { Context } from "hono";
import { AppError } from "./errors";
import type { AppEnv } from "../types";

/** Enforced only when TURNSTILE_SECRET_KEY is configured. Token comes from the `x-captcha-response` header. */
export async function assertTurnstile(c: Context<AppEnv>) {
  const secret = c.env.TURNSTILE_SECRET_KEY;
  if (!secret) return;
  const token = c.req.header("x-captcha-response");
  if (!token) throw new AppError(400, "CAPTCHA_REQUIRED", "Please complete the security check");
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  const ip = c.req.header("cf-connecting-ip");
  if (ip) body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean };
  if (!data.success) throw new AppError(400, "CAPTCHA_FAILED", "Security check failed. Please try again.");
}

import { and, count, desc, eq, gte, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { otpCodes } from "../db/schema";
import { AppError } from "../lib/errors";
import { sha256Hex } from "../lib/crypto";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const MAX_ATTEMPTS = 5;

type Mode = "twilio" | "dev";

export function otpMode(env: Env): Mode | null {
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID) return "twilio";
  if (env.APP_ENV !== "production") return "dev";
  return null;
}

function twilioAuth(env: Env) {
  return `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;
}

export async function sendOtp(env: Env, db: DB, phone: string): Promise<{ mode: Mode }> {
  const mode = otpMode(env);
  if (!mode) throw new AppError(503, "OTP_UNAVAILABLE", "Mobile verification is not available yet. Ask the shop staff for help.");

  const recent = await db
    .select({ n: count() })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), gte(otpCodes.createdAt, new Date(Date.now() - OTP_TTL_MS))))
    .get();
  if ((recent?.n ?? 0) >= MAX_SENDS_PER_WINDOW) {
    throw new AppError(429, "RATE_LIMITED", "Too many codes requested. Please wait 10 minutes.");
  }

  if (mode === "twilio") {
    const res = await fetch(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`, {
      method: "POST",
      headers: { Authorization: twilioAuth(env), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: `+91${phone}`, Channel: "sms" }),
    });
    if (!res.ok) {
      console.error("Twilio Verify send failed", res.status, await res.text());
      throw new AppError(502, "OTP_SEND_FAILED", "Could not send the code. Please try again.");
    }
    await db.insert(otpCodes).values({ phone, codeHash: "twilio", expiresAt: new Date(Date.now() + OTP_TTL_MS) });
    return { mode };
  }

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
  await db.insert(otpCodes).values({ phone, codeHash: await sha256Hex(`${phone}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS) });
  console.log(`[dev-otp] phone=${phone} code=${code}`);
  return { mode };
}

export async function verifyOtp(env: Env, db: DB, phone: string, code: string): Promise<boolean> {
  const mode = otpMode(env);
  if (!mode) throw new AppError(503, "OTP_UNAVAILABLE", "Mobile verification is not available yet.");

  const latest = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt), gte(otpCodes.expiresAt, new Date())))
    .orderBy(desc(otpCodes.createdAt))
    .get();
  if (!latest) return false;
  if (latest.attempts >= MAX_ATTEMPTS) throw new AppError(429, "RATE_LIMITED", "Too many wrong attempts. Request a new code.");
  await db.update(otpCodes).set({ attempts: latest.attempts + 1 }).where(eq(otpCodes.id, latest.id));

  let ok: boolean;
  if (mode === "twilio") {
    const res = await fetch(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`, {
      method: "POST",
      headers: { Authorization: twilioAuth(env), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: `+91${phone}`, Code: code }),
    });
    const data = (await res.json().catch(() => ({}))) as { status?: string };
    ok = res.ok && data.status === "approved";
  } else {
    ok = latest.codeHash === (await sha256Hex(`${phone}:${code}`));
  }
  if (ok) await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, latest.id));
  return ok;
}

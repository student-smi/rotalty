import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { captcha } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { DB } from "./db/client";
import { accounts, platformSettings, sessions, users, verifications } from "./db/schema";
import { hashPassword, verifyPassword } from "./lib/password";
import { sendEmail } from "./lib/mailer";

export function createAuth(env: Env, db: DB) {
  return betterAuth({
    appName: "Repeatly",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Reset your password",
          text: `Hi ${user.name},\n\nReset your password using this link (valid for 1 hour):\n${url}\n\nIf you did not request this, ignore this email.`,
          html: `<p>Hi ${escapeHtml(user.name)},</p><p><a href="${escapeHtml(url)}">Reset your password</a> (valid for 1 hour).</p><p>If you did not request this, ignore this email.</p>`,
        });
      },
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "user", input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    // Rate limiting is enforced by the Workers Rate Limiting binding in front of /api/auth.
    rateLimit: { enabled: false },
    advanced: {
      useSecureCookies: env.APP_ENV === "production",
      database: { generateId: () => crypto.randomUUID() },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const row = await db.select().from(platformSettings).where(eq(platformSettings.key, "signupsEnabled")).get();
        if (row?.value === false) throw new APIError("FORBIDDEN", { message: "New sign-ups are temporarily disabled" });
      }),
    },
    plugins: env.TURNSTILE_SECRET_KEY
      ? [captcha({ provider: "cloudflare-turnstile", secretKey: env.TURNSTILE_SECRET_KEY })]
      : [],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionData = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
export type AuthUser = SessionData["user"];

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

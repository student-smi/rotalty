import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { createAuth } from "./auth";
import { createDb } from "./db/client";
import { AppError } from "./lib/errors";
import { withContext } from "./middleware/auth";
import { loadCustomer } from "./middleware/customer";
import { rateLimit } from "./middleware/rate-limit";
import { adminRoutes } from "./routes/admin";
import { analyticsRoutes } from "./routes/analytics";
import { billingRoutes, razorpayWebhookRoutes } from "./routes/billing";
import { campaignRoutes, whatsappWebhookRoutes } from "./routes/campaigns";
import { crmRoutes } from "./routes/crm";
import { publicReviewRoutes, reviewRoutes } from "./routes/reviews";
import { businessRoutes } from "./routes/businesses";
import { waDraftRoutes } from "./routes/wa-drafts";
import { placesRoutes } from "./routes/places";
import { channelRoutes } from "./routes/channels";
import { customerRoutes } from "./routes/customer";
import { locationRoutes } from "./routes/locations";
import { loyaltyOpsRoutes } from "./routes/loyalty-ops";
import { meRoutes } from "./routes/me";
import { programRoutes } from "./routes/programs";
import { publicApiRoutes, shortLinkRoutes } from "./routes/public";
import { invitationRoutes, staffRoutes } from "./routes/staff";
import { runScheduled } from "./scheduled";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("/api/*", secureHeaders());

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/auth/*", rateLimit((env) => env.AUTH_LIMITER, "auth"));
app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env, createDb(c.env.DB)).handler(c.req.raw));

app.route("/", shortLinkRoutes);

// Webhooks authenticate by signature, not cookies, and must not be rate limited per IP.
app.route("/api/webhooks/whatsapp", whatsappWebhookRoutes);
app.route("/api/webhooks/razorpay", razorpayWebhookRoutes);

// Sensitive customer endpoints (OTP, join) share the stricter auth limiter.
app.post("/api/c/otp/*", rateLimit((env) => env.AUTH_LIMITER, "otp"));
app.post("/api/c/join", rateLimit((env) => env.AUTH_LIMITER, "join"));
app.post("/api/c/login", rateLimit((env) => env.AUTH_LIMITER, "c-login"));
app.post("/api/public/support", rateLimit((env) => env.AUTH_LIMITER, "support"));

app.use("/api/*", rateLimit((env) => env.API_LIMITER, "api"), withContext, loadCustomer);

app.route("/api/me", meRoutes);
app.route("/api/businesses", businessRoutes);
app.route("/api/businesses", locationRoutes);
app.route("/api/businesses", staffRoutes);
app.route("/api/businesses", programRoutes);
app.route("/api/businesses", loyaltyOpsRoutes);
app.route("/api/businesses", channelRoutes);
app.route("/api/businesses", reviewRoutes);
app.route("/api/businesses", crmRoutes);
app.route("/api/businesses", campaignRoutes);
app.route("/api/businesses", waDraftRoutes);
app.route("/api/businesses", analyticsRoutes);
app.route("/api/billing", billingRoutes);
app.route("/api/places", placesRoutes);
app.route("/api/invitations", invitationRoutes);
app.route("/api/public/review", publicReviewRoutes);
app.route("/api/public", publicApiRoutes);
app.route("/api/c", customerRoutes);
app.route("/api/admin", adminRoutes);

app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404));

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  if (err instanceof HTTPException) return err.getResponse();
  console.error("Unhandled error", err);
  return c.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller, env));
  },
} satisfies ExportedHandler<Env>;

export type AppType = typeof app;

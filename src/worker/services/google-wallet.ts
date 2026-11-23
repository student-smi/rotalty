import type { Context } from "hono";
import { and, asc, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { businesses, customerCards, customers, googleReviewSettings, loyaltyPrograms, rewards, walletPasses } from "../db/schema";
import { AppError } from "../lib/errors";
import { bytesToBase64Url } from "../lib/crypto";
import { createWalletCode } from "./card-token";
import type { AppEnv } from "../types";

/**
 * Google Wallet loyalty passes (Google Wallet API, REST + "Save to Google Wallet" JWT links).
 * https://developers.google.com/wallet/retail/loyalty-cards
 *
 * - One LoyaltyClass per loyalty program (shop name, logo, colour).
 * - One LoyaltyObject per customer card (stamps, next reward, static QR). Updated after every stamp/redeem.
 * Needs GOOGLE_WALLET_ISSUER_ID and GOOGLE_WALLET_SERVICE_ACCOUNT (the service account's JSON key).
 */
const API = "https://walletobjects.googleapis.com/walletobjects/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const BRAND_COLOR = "#5b5bd6";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export function walletEnabled(env: Env) {
  return !!(env.GOOGLE_WALLET_ISSUER_ID && env.GOOGLE_WALLET_SERVICE_ACCOUNT);
}

function config(env: Env) {
  if (!walletEnabled(env)) throw new AppError(503, "WALLET_NOT_CONFIGURED", "Google Wallet isn't available yet. Your web card works the same way.");
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(env.GOOGLE_WALLET_SERVICE_ACCOUNT!);
  } catch {
    throw new AppError(503, "WALLET_NOT_CONFIGURED", "Google Wallet isn't set up correctly.");
  }
  if (!sa.client_email || !sa.private_key) throw new AppError(503, "WALLET_NOT_CONFIGURED", "Google Wallet isn't set up correctly.");
  return { issuerId: env.GOOGLE_WALLET_ISSUER_ID!.trim(), sa };
}

// ---------- JWT (RS256) ----------

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(pem: string) {
  let key = keyCache.get(pem);
  if (!key) {
    const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
    const der = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    key = crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    keyCache.set(pem, key);
  }
  return key;
}

const encodePart = (v: unknown) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(v)));

export async function signJwt(privateKeyPem: string, claims: Record<string, unknown>) {
  const unsigned = `${encodePart({ alg: "RS256", typ: "JWT" })}.${encodePart(claims)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await importKey(privateKeyPem), new TextEncoder().encode(unsigned));
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

// ---------- OAuth access token (service account, cached per isolate) ----------

let cachedToken: { email: string; token: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount) {
  if (cachedToken && cachedToken.email === sa.client_email && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(sa.private_key, { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) {
    console.error("Google OAuth error", res.status, (await res.text()).slice(0, 300));
    throw new AppError(502, "WALLET_UNAVAILABLE", "Google Wallet is not responding. Please try again.");
  }
  const body = await res.json<{ access_token: string; expires_in: number }>();
  cachedToken = { email: sa.client_email, token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

async function walletApi(sa: ServiceAccount, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res;
}

async function upsert(sa: ServiceAccount, kind: "loyaltyClass" | "loyaltyObject", body: { id: string }) {
  const inserted = await walletApi(sa, "POST", `/${kind}`, body);
  if (inserted.ok) return;
  if (inserted.status !== 409) {
    console.error(`Wallet ${kind} insert failed`, inserted.status, (await inserted.text()).slice(0, 500));
    throw new AppError(502, "WALLET_UNAVAILABLE", "Google Wallet is not responding. Please try again.");
  }
  // Already exists: refresh it so name, logo and points stay current.
  const patched = await walletApi(sa, "PATCH", `/${kind}/${encodeURIComponent(body.id)}`, body);
  if (!patched.ok) {
    console.error(`Wallet ${kind} patch failed`, patched.status, (await patched.text()).slice(0, 500));
    throw new AppError(502, "WALLET_UNAVAILABLE", "Google Wallet is not responding. Please try again.");
  }
}

// ---------- Pass content ----------

/** Wallet ids allow letters, digits, '.', '_' and '-'. */
export const walletClassId = (issuerId: string, programId: string) => `${issuerId}.program-${programId}`;
export const walletObjectId = (issuerId: string, cardId: string) => `${issuerId}.card-${cardId}`;

async function loadCard(db: DB, cardId: string) {
  const row = await db
    .select({ card: customerCards, program: loyaltyPrograms, business: businesses, customer: customers, review: googleReviewSettings })
    .from(customerCards)
    .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, customerCards.programId))
    .innerJoin(businesses, eq(businesses.id, customerCards.businessId))
    .innerJoin(customers, eq(customers.id, customerCards.customerId))
    .leftJoin(googleReviewSettings, eq(googleReviewSettings.businessId, customerCards.businessId))
    .where(eq(customerCards.id, cardId))
    .get();
  if (!row) return null;
  const rs = await db
    .select({ name: rewards.name, pointsRequired: rewards.pointsRequired })
    .from(rewards)
    .where(and(eq(rewards.programId, row.program.id), eq(rewards.isActive, true)))
    .orderBy(asc(rewards.pointsRequired))
    .all();
  return { ...row, rewards: rs };
}

type CardData = NonNullable<Awaited<ReturnType<typeof loadCard>>>;

export function buildClass(issuerId: string, d: Pick<CardData, "business" | "program">, baseUrl: string) {
  const logo = d.business.logoKey ? `${baseUrl}/api/public/media/${d.business.logoKey}` : `${baseUrl}/wallet-logo.png`;
  return {
    id: walletClassId(issuerId, d.program.id),
    issuerName: d.business.name.slice(0, 60),
    programName: d.program.name.slice(0, 60),
    programLogo: { sourceUri: { uri: logo }, contentDescription: { defaultValue: { language: "en", value: `${d.business.name} logo` } } },
    hexBackgroundColor: BRAND_COLOR,
    reviewStatus: "UNDER_REVIEW",
  };
}

export async function buildObject(issuerId: string, d: CardData, baseUrl: string, secret: string) {
  const points = d.card.pointsBalance;
  const ready = d.rewards.filter((r) => points >= r.pointsRequired);
  const next = d.rewards.find((r) => points < r.pointsRequired);
  const nextText = ready.length
    ? `🎉 ${ready.map((r) => r.name).join(", ")} ready! Show this card at the counter.`
    : next
      ? `${next.pointsRequired - points} more for ${next.name}`
      : "Keep collecting stamps";
  const active = d.card.status === "active" && d.business.status === "active" && !d.business.deletedAt;
  const links = [{ id: "card", uri: `${baseUrl}/c/cards/${d.card.id}`, description: "Open my card" }];
  if (d.review?.enabled && d.review.reviewUrl) links.push({ id: "review", uri: `${baseUrl}/s/${d.business.slug}/review`, description: "Review us on Google" });

  return {
    id: walletObjectId(issuerId, d.card.id),
    classId: walletClassId(issuerId, d.program.id),
    state: active ? "ACTIVE" : "INACTIVE",
    accountId: d.card.id.slice(0, 8).toUpperCase(),
    accountName: (d.customer.name ?? "Customer").slice(0, 40),
    loyaltyPoints: { label: "Stamps", balance: { string: `${points} / ${d.program.stampsRequired}` } },
    secondaryLoyaltyPoints: { label: "Rewards ready", balance: { int: ready.length } },
    barcode: { type: "QR_CODE", value: await createWalletCode(secret, d.card.id), alternateText: "Show at the counter" },
    textModulesData: [{ id: "next", header: "Next reward", body: nextText }],
    linksModuleData: { uris: links },
  };
}

// ---------- Public operations ----------

/** Creates/refreshes the program class and the card object, then returns the "Save to Google Wallet" link. */
export async function googleWalletSaveUrl(env: Env, db: DB, cardId: string) {
  const { issuerId, sa } = config(env);
  const d = await loadCard(db, cardId);
  if (!d) throw new AppError(404, "NOT_FOUND", "Card not found");
  const baseUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const cls = buildClass(issuerId, d, baseUrl);
  const obj = await buildObject(issuerId, d, baseUrl, env.BETTER_AUTH_SECRET);
  await upsert(sa, "loyaltyClass", cls);
  await upsert(sa, "loyaltyObject", obj);
  await db
    .insert(walletPasses)
    .values({ cardId, platform: "google", objectId: obj.id, classId: cls.id, lastSyncedAt: new Date() })
    .onConflictDoUpdate({ target: [walletPasses.cardId, walletPasses.platform], set: { objectId: obj.id, classId: cls.id, lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() } });

  const jwt = await signJwt(sa.private_key, {
    iss: sa.client_email,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [baseUrl],
    payload: { loyaltyObjects: [{ id: obj.id, classId: cls.id }] },
  });
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

/** Push the latest stamps/state to a card that has a Google Wallet pass. No-op otherwise. */
export async function syncGoogleWalletCard(env: Env, db: DB, cardId: string) {
  if (!walletEnabled(env)) return;
  const pass = await db.select().from(walletPasses).where(and(eq(walletPasses.cardId, cardId), eq(walletPasses.platform, "google"))).get();
  if (!pass) return;
  const { issuerId, sa } = config(env);
  const d = await loadCard(db, cardId);
  if (!d) return;
  const obj = await buildObject(issuerId, d, env.BETTER_AUTH_URL.replace(/\/$/, ""), env.BETTER_AUTH_SECRET);
  const { id: _id, classId: _classId, ...changes } = obj;
  const res = await walletApi(sa, "PATCH", `/loyaltyObject/${encodeURIComponent(pass.objectId)}`, changes);
  const error = res.ok ? null : `${res.status} ${(await res.text()).slice(0, 200)}`;
  if (error) console.error("Wallet sync failed", cardId, error);
  await db.update(walletPasses).set({ lastSyncedAt: new Date(), lastError: error, updatedAt: new Date() }).where(eq(walletPasses.id, pass.id));
}

/** Fire-and-forget sync after a stamp, redemption or block. */
export function queueWalletSync(c: Context<AppEnv>, cardId: string) {
  if (!walletEnabled(c.env)) return;
  const task = syncGoogleWalletCard(c.env, c.get("db"), cardId).catch((err) => console.error("Wallet sync error", err));
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    // No execution context (e.g. scheduled jobs): the promise still runs.
  }
}

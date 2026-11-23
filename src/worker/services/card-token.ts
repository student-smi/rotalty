import { base64UrlToBytes, bytesToBase64Url, randomToken, timingSafeEqual } from "../lib/crypto";
import { CARD_TOKEN_PREFIX } from "../../shared/domain";

/** Rotating QR shown on a customer's card. Short-lived and single-use (enforced via the ledger's idempotency key). */
export const CARD_TOKEN_TTL_SECONDS = 90;

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function signingKey(secret: string) {
  let key = keyCache.get(secret);
  if (!key) {
    key = (async () => {
      const master = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      // Derive a purpose-specific key so the auth secret itself never signs card tokens.
      const derived = await crypto.subtle.sign("HMAC", master, encoder.encode("card-token-v1"));
      return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    })();
    keyCache.set(secret, key);
  }
  return key;
}

async function mac(secret: string, message: string) {
  const sig = await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(message));
  return new Uint8Array(sig).slice(0, 16);
}

export async function createCardToken(secret: string, cardId: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + CARD_TOKEN_TTL_SECONDS;
  const nonce = randomToken(9);
  const sig = bytesToBase64Url(await mac(secret, `v1|${cardId}|${exp}|${nonce}`));
  return { token: `${CARD_TOKEN_PREFIX}${cardId}.${exp}.${nonce}.${sig}`, expiresAt: new Date(exp * 1000) };
}

export type TokenCheck =
  | { ok: true; cardId: string; nonce: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export async function verifyCardToken(secret: string, raw: string, now = Date.now()): Promise<TokenCheck> {
  const token = raw.trim().startsWith(CARD_TOKEN_PREFIX) ? raw.trim().slice(CARD_TOKEN_PREFIX.length) : raw.trim();
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [cardId, expStr, nonce, sig] = parts as [string, string, string, string];
  const exp = Number(expStr);
  if (!/^[0-9a-f-]{36}$/.test(cardId) || !Number.isInteger(exp) || !nonce || !sig) return { ok: false, reason: "malformed" };
  let given: Uint8Array;
  try {
    given = base64UrlToBytes(sig);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!timingSafeEqual(given, await mac(secret, `v1|${cardId}|${exp}|${nonce}`))) return { ok: false, reason: "bad_signature" };
  if (exp * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, cardId, nonce };
}

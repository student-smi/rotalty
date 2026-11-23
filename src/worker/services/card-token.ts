import { base64UrlToBytes, bytesToBase64Url, randomToken, timingSafeEqual } from "../lib/crypto";
import { CARD_TOKEN_PREFIX, WALLET_CODE_PREFIX } from "../../shared/domain";

export { WALLET_CODE_PREFIX };

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

// ---------- Static wallet code ----------
// Google/Apple Wallet passes can't rotate their barcode, so wallet cards carry a fixed signed code.
// It is accepted for collecting points (daily limit + cooldown still apply); redeeming a reward with it
// asks staff to confirm the customer's mobile number.


export async function createWalletCode(secret: string, cardId: string) {
  const sig = bytesToBase64Url(await mac(secret, `wallet|${cardId}`));
  return `${WALLET_CODE_PREFIX}${cardId}.${sig}`;
}

export async function verifyWalletCode(secret: string, raw: string): Promise<{ ok: true; cardId: string } | { ok: false }> {
  const value = raw.trim();
  if (!value.startsWith(WALLET_CODE_PREFIX)) return { ok: false };
  const [cardId, sig, ...rest] = value.slice(WALLET_CODE_PREFIX.length).split(".");
  if (rest.length || !cardId || !sig || !/^[0-9a-f-]{36}$/.test(cardId)) return { ok: false };
  let given: Uint8Array;
  try {
    given = base64UrlToBytes(sig);
  } catch {
    return { ok: false };
  }
  return timingSafeEqual(given, await mac(secret, `wallet|${cardId}`)) ? { ok: true, cardId } : { ok: false };
}

export type AnyCardCode =
  | { ok: true; cardId: string; source: "rotating"; nonce: string }
  | { ok: true; cardId: string; source: "wallet" }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/** Accepts either the rotating web-card QR or a wallet pass's static code. */
export async function verifyAnyCardCode(secret: string, raw: string, now = Date.now()): Promise<AnyCardCode> {
  if (raw.trim().startsWith(WALLET_CODE_PREFIX)) {
    const w = await verifyWalletCode(secret, raw);
    return w.ok ? { ok: true, cardId: w.cardId, source: "wallet" } : { ok: false, reason: "bad_signature" };
  }
  const r = await verifyCardToken(secret, raw, now);
  return r.ok ? { ok: true, cardId: r.cardId, source: "rotating", nonce: r.nonce } : r;
}

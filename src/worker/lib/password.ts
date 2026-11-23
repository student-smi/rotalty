import { base64UrlToBytes, bytesToBase64Url, timingSafeEqual } from "./crypto";

// PBKDF2 via WebCrypto instead of Better Auth's default JS scrypt, which can exceed Workers CPU limits.
// 100,000 is the maximum iteration count the Workers runtime accepts.
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const PREFIX = "pbkdf2_sha256";

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const [prefix, iter, salt, expected] = hash.split("$");
  if (prefix !== PREFIX || !iter || !salt || !expected) return false;
  const iterations = Number(iter);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
  const actual = await derive(password, base64UrlToBytes(salt), iterations);
  return timingSafeEqual(actual, base64UrlToBytes(expected));
}

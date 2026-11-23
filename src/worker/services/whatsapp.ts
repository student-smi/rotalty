import { timingSafeEqual } from "../lib/crypto";

const GRAPH_VERSION = "v21.0";

export function isWhatsAppConfigured(env: Env) {
  return Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
}

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

export interface TemplateMessage {
  /** E.164 without "+", e.g. 919876543210. */
  to: string;
  templateName: string;
  language: string;
  bodyParams: string[];
}

/** Sends an approved template via the WhatsApp Cloud API. Returns the provider message id. */
export async function sendTemplate(env: Env, msg: TemplateMessage): Promise<string> {
  if (!isWhatsAppConfigured(env)) throw new WhatsAppSendError("not_configured", false);
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to,
        type: "template",
        template: {
          name: msg.templateName,
          language: { code: msg.language },
          ...(msg.bodyParams.length
            ? { components: [{ type: "body", parameters: msg.bodyParams.map((text) => ({ type: "text", text })) }] }
            : {}),
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new WhatsAppSendError(`network: ${(err as Error).message}`.slice(0, 300), true);
  }
  const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (res.ok && data.messages?.[0]?.id) return data.messages[0].id;
  const detail = `${res.status}${data.error?.code ? `/${data.error.code}` : ""}: ${data.error?.message ?? "unknown error"}`.slice(0, 300);
  // Meta rate-limit codes (130429, 131048, 131056) and 5xx are transient; other 4xx (bad template, invalid number) are permanent.
  const rateLimited = res.status === 429 || [130429, 131048, 131056].includes(data.error?.code ?? 0);
  throw new WhatsAppSendError(detail, rateLimited || res.status >= 500);
}

function hexToBytes(hex: string) {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Validates Meta's X-Hub-Signature-256 header ("sha256=<hex HMAC of the raw body>"). */
export async function verifyWebhookSignature(secret: string, rawBody: string, header: string | undefined) {
  if (!header?.startsWith("sha256=")) return false;
  const given = hexToBytes(header.slice(7));
  if (!given) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return timingSafeEqual(given, expected);
}

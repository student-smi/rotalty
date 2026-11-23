// Optional secrets. Not declared in wrangler.jsonc, so `wrangler types` cannot see them.
interface OptionalBindings {
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  // Phone OTP (Twilio Verify). Customer OTP is only enforced when CUSTOMER_OTP=on.
  CUSTOMER_OTP?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;
  // Review AI: Cloudflare Workers AI by default; AI_PROVIDER=gemini switches to Google Gemini.
  AI_PROVIDER?: string;
  WORKERS_AI_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  AI_PRICE_INPUT_PER_MTOK_USD?: string;
  AI_PRICE_OUTPUT_PER_MTOK_USD?: string;
  // WhatsApp Business Platform (Cloud API)
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  // Google Places API (New): shop search & autofill
  GOOGLE_PLACES_API_KEY?: string;
  // Google Wallet loyalty passes: issuer id + service account JSON key (secret).
  GOOGLE_WALLET_ISSUER_ID?: string;
  GOOGLE_WALLET_SERVICE_ACCOUNT?: string;
  // Razorpay
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
}

interface Env extends OptionalBindings {}

declare namespace Cloudflare {
  interface Env extends OptionalBindings {}
}

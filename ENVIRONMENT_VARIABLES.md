# Environment Variables

Local development: `.dev.vars` (gitignored; template `.dev.vars.example`). Production: `npx wrangler secret put <NAME>`.

## Worker vars (`wrangler.jsonc` → `vars`)

| Name | Production value | Notes |
|---|---|---|
| `APP_ENV` | `production` | Secure cookies; disables dev-only fallbacks (console email/OTP). `.dev.vars` sets `development` locally |
| `BETTER_AUTH_URL` | `https://loyalty-review-platform.smitpanchal734.workers.dev` | Public origin: auth callbacks, invite/QR/NFC links |

## Secrets

Every integration is optional except `BETTER_AUTH_SECRET`. Without its keys a feature reports a clear "not configured" state — nothing is faked.

| Name | Feature | Status without it |
|---|---|---|
| `BETTER_AUTH_SECRET` | Sessions, card QR signing (derived key) | **Required** |
| `TURNSTILE_SECRET_KEY` (+ build-time `VITE_TURNSTILE_SITE_KEY`) | Bot protection on sign-up, sign-in, customer join/OTP, AI drafts | Not enforced |
| `RESEND_API_KEY`, `EMAIL_FROM` | Password-reset & staff-invite emails | Invite links shown to owner to share; reset emails not delivered in production |
| `CUSTOMER_OTP` | Set to `on` to require a one-time code before a customer can open existing cards (also needs Twilio below) | **Off (current):** the mobile number alone opens a customer's cards (`POST /c/login`), and joining with a known number adds the card to that customer |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | Customer phone OTP (card recovery), used when `CUSTOMER_OTP=on` | Dev: code printed to log. Production: recovery unavailable; staff can look customers up by phone |
| *(binding)* `AI` | **Cloudflare Workers AI** — default provider for review drafts. Declared in `wrangler.jsonc`; no key needed | — |
| `WORKERS_AI_MODEL` (var) | Model override (default `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, a JSON-mode model) | — |
| `AI_GATEWAY_ID` (var) | Route Workers AI through Cloudflare AI Gateway (logs, caching, rate limits) | Calls Workers AI directly |
| `AI_PROVIDER` (var) | Set to `gemini` to use Google Gemini instead of Workers AI | Workers AI |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_GATEWAY_ACCOUNT_ID` | Only when `AI_PROVIDER=gemini` | — |
| `AI_PRICE_INPUT_PER_MTOK_USD`, `AI_PRICE_OUTPUT_PER_MTOK_USD` | Cost estimates in AI usage logs | Built-in defaults |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API sending | Campaigns can't be sent |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | WhatsApp webhook signature + verification | Webhook rejects calls |
| `GOOGLE_PLACES_API_KEY` | "Find your shop on Google" autofill (onboarding, Shop settings, review link finder). Needs **Places API (New)** enabled; restrict the key to that API. Server-side only, never sent to the browser | Search box is hidden; owners type details manually |
| `GOOGLE_WALLET_ISSUER_ID` | Issuer ID from the Google Pay & Wallet Console | "Add to Google Wallet" button hidden |
| `GOOGLE_WALLET_SERVICE_ACCOUNT` | Full JSON key of a Google Cloud service account (Google Wallet API enabled; account invited as Developer in the Wallet Console). Secret — set with `wrangler secret put` | Same as above |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Plan checkout | "Payments not configured"; admins can grant plans manually |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook | Webhook rejects calls (checkout verification still works) |

# Cloudflare Setup

The platform needs only **Workers, D1, Workers AI, Cron Triggers and the Rate Limiting binding** — all available on the Workers Free plan. R2, KV and Queues are not required (logos are stored in D1; background jobs use a D1 outbox processed by cron).

## 1. Authenticate

```bash
npx wrangler login          # browser OAuth (recommended)
# or, in CI: set CLOUDFLARE_API_TOKEN to a scoped token (Workers Scripts:Edit, D1:Edit)
```

Never paste API keys into code, chat or committed files.

## 2. Create the database

```bash
npx wrangler d1 create loyalty-db --location apac
```

Put the printed `database_id` in `wrangler.jsonc`, then apply migrations:

```bash
npm run db:migrate:remote
```

## 3. Secrets

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put BETTER_AUTH_SECRET
```

Google shop search (optional, enable **Places API (New)** in Google Cloud first):

```bash
npx wrangler secret put GOOGLE_PLACES_API_KEY
```

Optional integrations — see [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md).

## 4. Cron triggers

Declared in `wrangler.jsonc`:

| Cron | Purpose |
|---|---|
| `* * * * *` | Deliver queued WhatsApp messages (outbox) |
| `30 3 * * *` (09:00 IST) | Birthday / win-back / inactive / progress automations, scheduled campaigns, subscription expiry |

## 5. Optional services

| Service | How |
|---|---|
| **Turnstile** | Dashboard → Turnstile → add widget. Secret → `TURNSTILE_SECRET_KEY`; site key → `VITE_TURNSTILE_SITE_KEY` at build time |
| **Workers AI** | Enabled by the `ai` binding in `wrangler.jsonc` — review drafts work with no extra keys (free daily allocation, then usage-based). Local `npm run dev` calls Cloudflare, so run `npx wrangler login` first |
| **AI Gateway** (optional) | Dashboard → AI → AI Gateway → create a gateway, then add `"AI_GATEWAY_ID": "<name>"` to `vars` |
| **Gemini** (optional) | Set `AI_PROVIDER=gemini` and the `GEMINI_API_KEY` secret |
| **WhatsApp** | Meta Business verification → WhatsApp Cloud API app → permanent token, phone number id, app secret. Webhook URL: `https://<host>/api/webhooks/whatsapp` (subscribe to `messages`). Create & get approval for message templates in WhatsApp Manager |
| **Razorpay** | Dashboard → API keys; Webhooks → URL `https://<host>/api/webhooks/razorpay`, events `payment.captured`, `order.paid`, `payment.failed` |
| **Twilio Verify** | Create a Verify service; set the three `TWILIO_*` secrets |
| **Custom domain** | Workers → loyalty-review-platform → Settings → Domains & Routes; then update `BETTER_AUTH_URL` |

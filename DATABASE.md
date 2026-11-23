# Database

Cloudflare D1 (SQLite) via Drizzle ORM. Schema source: [src/worker/db/schema.ts](src/worker/db/schema.ts). Migrations: [migrations/](migrations/).

## Conventions

- UUID v4 text primary keys; integer millisecond timestamps (`created_at`, `updated_at`).
- Every tenant-owned table has `business_id` with an index; every business-scoped query filters on it.
- Soft deletion (`deleted_at`) for businesses, locations, programs and customers (customers are anonymised, not removed).
- **Immutable ledger:** `stamp_transactions` rows are only ever inserted.
- Atomic multi-statement writes use `db.batch()` (D1 has no interactive transactions).

## Workflow

```bash
# edit src/worker/db/schema.ts
npm run db:generate -- --name <change>   # writes migrations/NNNN_<change>.sql
npm run db:migrate:local
npm run db:migrate:remote
```

| Migration | Contents |
|---|---|
| `0000_foundation` | Auth, businesses, locations, staff, invitations, audit logs |
| `0001_all_modules` | Loyalty, customers, QR/NFC, reviews/AI, CRM/marketing, SaaS tables, media |
| `0002_seed_plans` | Free / Starter / Professional / Agency plans (editable by Super Admin) |
| `0003_google_places` | `businesses.google_place_id`, `latitude`, `longitude` |
| `0005_wallet_passes` | `wallet_passes` (UNIQUE card + platform): Google Wallet object per card, last sync time / error |
| `0004_review_keywords` | `review_keywords` (UNIQUE business + normalized text), `google_review_settings.show_on_card` |

## Tables

| Area | Table | Notes / key constraints |
|---|---|---|
| Auth | `users`, `sessions`, `accounts`, `verifications` | Better Auth. `users.role` = user / super_admin |
| Tenancy | `businesses` | UNIQUE slug; status; channel switches `qr_enabled`, `nfc_tag_enabled`, `nfc_phone_enabled` |
| | `business_locations`, `business_staff`, `staff_invitations` | UNIQUE (business_id, user_id); hashed invite tokens |
| | `media` | Logos stored as BLOBs (≤ 300 KB) — no R2 needed |
| Loyalty | `loyalty_programs` | stamps, dates, status, `daily_limit_per_customer`, `cooldown_minutes` |
| | `rewards` | Reward tiers per program (`points_required` ≤ stamps) |
| | `customers` | One per phone (UNIQUE phone; NULL after erasure) |
| | `customer_sessions`, `otp_codes` | Customer device sessions (hashed tokens); OTP rate-limit/attempt tracking |
| | `customer_cards` | UNIQUE (program_id, customer_id); **CHECK points_balance ≥ 0** |
| | `stamp_transactions` | Append-only ledger. **UNIQUE idempotency_key** (no double issue) and **UNIQUE daily_slot** (race-safe daily limit) |
| | `reward_redemptions` | Snapshot of reward name/points |
| QR & NFC | `qr_codes`, `nfc_tags` | UNIQUE short codes, status, scan/tap counters, replacement chain |
| | `nfc_sessions` | Tap-to-collect requests awaiting staff approval (5-min expiry) |
| Analytics | `interaction_events` | Scans, taps, issue/redeem success & failure reasons, device incompatibility, review funnel |
| Reviews | `google_review_settings`, `review_assistant_sessions`, `review_drafts`, `ai_usage_logs` | Token usage + estimated cost per call |
| CRM / Marketing | `customer_consents` | UNIQUE (business, customer, channel); granted/withdrawn with source + timestamps |
| | `marketing_campaigns`, `notification_logs` | `notification_logs` doubles as the outbox (status, attempts, next_attempt_at, UNIQUE dedupe_key, UNIQUE provider_message_id) |
| SaaS | `subscription_plans` | Limits as JSON (`null` = unlimited) |
| | `subscriptions` | One per owner account (UNIQUE user_id) |
| | `payment_transactions` | UNIQUE order_id and payment_id (idempotent activation) |
| | `platform_settings`, `audit_logs` | |

## How the database enforces business rules

| Rule | Mechanism |
|---|---|
| A scanned QR token can't issue twice | `stamp_transactions.idempotency_key = qr:<nonce>` UNIQUE |
| Daily limit holds under concurrent requests | `daily_slot = <card>:<IST date>:<n>` UNIQUE |
| A reward can't be redeemed twice from one balance | `CHECK (points_balance >= 0)` aborts the whole batch |
| An NFC request is approved only once | idempotency key `nfc:<sessionId>` |
| A payment activates a plan once | UNIQUE `payment_transactions.payment_id` |
| A scheduled/automated message is sent once | UNIQUE `notification_logs.dedupe_key` |

## D1 limits

10 GB per database; ~100 bound parameters per statement (bulk inserts are chunked); no interactive transactions.

# API

Base path `/api`, JSON. Staff use the Better Auth session cookie; customers use a separate `lr_customer` cookie. Errors: `{ "error": { "code", "message", "details?" } }`.

Common codes: `BAD_REQUEST` 400, `UNAUTHORIZED` 401, `CUSTOMER_UNAUTHORIZED` 401, `FORBIDDEN` 403, `PLAN_LIMIT_REACHED` 403, `BUSINESS_SUSPENDED` 403, `NOT_FOUND` 404, `CONFLICT` 409, `RATE_LIMITED` 429, `*_UNAVAILABLE` / `*_NOT_CONFIGURED` 503 (missing credentials).

`B` = `/businesses/:businessId` (permission in brackets).

## Auth & account
`POST /auth/sign-up/email`, `/auth/sign-in/email`, `/auth/sign-out`, `/auth/request-password-reset`, `/auth/reset-password` · `GET /me`

## Business & team
`POST /businesses` · `GET|PATCH B` [business.manage] · `POST B/logo` (multipart, ≤300 KB) · `GET|POST B/locations`, `PATCH|DELETE B/locations/:id` [locations.manage] · `GET B/staff`, `PATCH B/staff/:id`, `GET|POST B/invitations`, `DELETE B/invitations/:id` [staff.manage] · `GET /invitations/:token`, `POST /invitations/:token/accept`

## Google shop search (Places API New)
`GET /places/status` → `{enabled}` · `GET /places/autocomplete?q=&session=` [signed in] → `{suggestions:[{placeId,name,secondary}]}` (India only) · `GET /places/details/:placeId?session=` [signed in] → `{place}` with name, mapped category, address/city/state/pincode, mobile (landlines → `null`, raw in `phoneDisplay`), lat/lng, rating, `reviewUrl`. Reuse one `session` (UUID) for the typing and the final details call so Google bills one session. Errors: `503 PLACES_NOT_CONFIGURED`, `502 PLACES_UNAVAILABLE`.

`POST /businesses` and `PATCH B` accept `googlePlaceId`, `latitude`, `longitude`. A new `googlePlaceId` pre-fills the review link (`https://search.google.com/local/writereview?placeid=…`) only if none is set; the review helper stays off until the owner enables it.

## Loyalty (Phase 2)
| Endpoint | Permission |
|---|---|
| `GET B/programs` | member |
| `POST B/programs`, `PATCH B/programs/:id`, `POST B/programs/:id/rewards`, `PATCH B/rewards/:id` | loyalty.manage |
| `POST B/issue/scan` `{token, locationId?}` — scan customer card QR | points.issue |
| `POST B/cards/:cardId/points` `{idempotencyKey}` — staff-assisted | points.issue |
| `POST B/cards/:cardId/redeem` `{rewardId, idempotencyKey}` | rewards.redeem |
| `POST B/cards/resolve` `{token}`, `GET B/lookup?phone=`, `GET B/cards/:cardId` | issue/redeem/customers.view |
| `GET B/transactions`, `GET B/redemptions` (cursor `before`) | customers.view / rewards.redeem |

Engine error codes: `DUPLICATE`, `DAILY_LIMIT`, `COOLDOWN`, `PROGRAM_INACTIVE`, `CARD_BLOCKED`, `INSUFFICIENT_POINTS`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `CHANNEL_DISABLED`.

## QR & NFC (Phases 2 & 4)
`GET|PATCH B/channels` · `POST B/qr-codes`, `POST B/qr-codes/:id/revoke|rotate` · `POST B/nfc-tags`, `POST B/nfc-tags/:id/revoke|replace` · `GET B/nfc-history` [loyalty.manage] · `GET B/nfc-requests`, `POST B/nfc-requests/:id/approve|reject` [points.issue]
Short links (not under /api): `GET /q/:code` (printed QR) and `GET /t/:code` (NFC tag) → 302 to the business page. They never issue points.

## Public & customer
`GET /public/plans` (active plans for the landing page, no auth) · `GET /public/b/:slug` · `GET /public/media/:id`
`GET /c/session` · `POST /c/join` · `POST /c/otp/send` · `POST /c/otp/verify` · `POST /c/logout` · `GET /c/cards` · `GET /c/cards/:id` · `POST /c/cards/:id/token` · `POST /c/nfc-requests` · `GET /c/nfc-requests/:id` · `POST /c/device-unsupported` · `PATCH|DELETE /c/me` · `GET|PUT /c/consents`

## AI Review Assistant (Phase 3)
`GET|PUT B/review-settings` [reviews.manage] · `GET B/review-analytics?days=` [reviews.manage|analytics.view]
`GET /public/review/:slug` · `POST /public/review/:slug/drafts` · `POST /public/review/sessions/:id/redirect` · `POST /public/review/:slug/redirect`

## CRM (Phase 5)
`GET B/customers?q=&segment=&page=`, `GET B/customers/stats`, `GET B/customers/:id`, `PUT B/customers/:id/consents/:channel` [customers.view] · `GET B/customers/export` (CSV) [customers.export] · `PATCH B/cards/:id` [loyalty.manage]

## Marketing (Phase 6) [campaigns.manage]
`GET B/marketing/status` · `GET|POST B/campaigns` · `GET B/campaigns/audience-preview` · `PATCH B/campaigns/:id` · `POST B/campaigns/:id/send|activate|pause|cancel` · `GET B/campaigns/:id/logs`
Webhook: `GET|POST /webhooks/whatsapp` (signature-verified)

## Analytics (Phase 7)
`GET B/analytics/overview?days=7|30|90` [analytics.view] (90 days + advanced sections are plan-gated)

## Billing (Phase 8)
`GET /billing/plans` · `GET /billing/subscription` · `POST /billing/checkout {planCode}` · `POST /billing/verify` · `GET /billing/payments` · `GET /billing/platform-status`
Webhook: `POST /webhooks/razorpay` (signature-verified)

## Super Admin (`/admin/*`, role super_admin)
`overview` · `businesses` (+ `PATCH /:id/status`) · `subscriptions` (+ `PUT /:userId`) · `revenue` · `ai-usage` · `transactions` · `suspicious` · `plans` (+ `PUT /:id`) · `settings` (GET/PUT) · `health`

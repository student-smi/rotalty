# Development Progress

Legend: ✅ Fully Implemented · 🟡 Partially Implemented · 🔑 Requires API Credentials · ⬜ Not Implemented

**Production:** https://loyalty-review-platform.smitpanchal734.workers.dev — last deployed 2026-11-23 · D1 `loyalty-db` (APAC), migrations 0000–0002 applied · crons active.
**Tests:** 145 passing across 14 files (run inside the Workers runtime).
**Not yet done for any phase:** clicking through the UI in a real browser/phone, camera scanning, and NFC hardware tests.

## Phase 1 — Foundation ✅
Auth (email + password, reset 🔑 email), RBAC (owner/manager/staff + custom permissions), tenant isolation, businesses, locations, staff invitations, audit logs, rate limiting, Turnstile 🔑, logos stored in D1 (no R2), Super Admin sign-up switch.

## Phase 2 — Loyalty Engine & QR ✅
| Feature | Status |
|---|---|
| Programs (stamps, dates, eligibility, terms, daily limit, cooldown, status) + reward tiers | ✅ |
| Customer join without app/password; multiple cards per customer | ✅ |
| Single Loyalty Engine for all channels; append-only ledger | ✅ |
| Duplicate prevention (idempotency keys), race-safe daily limit, cooldown | ✅ tested incl. concurrency |
| Rotating signed customer QR (90 s, single-use) + staff camera scanner | ✅ (camera untested on devices) |
| Staff-assisted issuance by phone lookup | ✅ |
| Reward unlock + redemption (race-safe via CHECK constraint) | ✅ |
| Printed business QR codes: PNG/SVG, rotation, revocation, scan tracking | ✅ |
| Customer "Find my cards" with mobile number only (OTP switched off for now) | ✅ |
| Customer card recovery via phone OTP (`CUSTOMER_OTP=on`) | ⏸ kept for later — 🔑 Twilio Verify |

## Phase 3 — AI Review Assistant ✅
| Feature | Status |
|---|---|
| Review settings (Google URL validated), public assistant page, 4 languages | ✅ |
| 3 drafts via **Cloudflare Workers AI** (JSON mode, validated, sentiment-preserving, script check for Hindi/Gujarati), edit/copy/regenerate | ✅ no key needed (Hindi/Gujarati quality to be checked with real usage) |
| Google Gemini as alternative provider | 🔑 `AI_PROVIDER=gemini` + `GEMINI_API_KEY` |
| AI Gateway routing, usage + cost logging, plan limits | ✅ (gateway optional) |
| Google Maps redirect tracking (labelled clicks, never "published reviews") | ✅ |
| Policy: no incentives, no gating, independent of loyalty, never auto-posts | ✅ |

## Phase 4 — NFC 🟡
| Feature | Status |
|---|---|
| NFC tag registration, location, revoke, replace, tap tracking, history | ✅ |
| Write URL to tag via Web NFC (Chrome Android) or NFC Tools app | ✅ (untested on hardware) |
| Tap → customer request → **staff approval** → point (static URL never issues points) | ✅ tested |
| Phone-to-phone NFC | ⬜ Not possible in browsers (no card emulation; no Web NFC on iOS). Needs a native Android HCE app. Capability detection + QR fallback implemented |
| Real-device testing | ⬜ Required before launch |

## Phase 5 — CRM ✅
Customer list/search/segments (new, regular, loyal, inactive, reward-eligible), profile + activity, CSV export (injection-safe, audited), card block/unblock, consent view + business-recorded withdrawals, customer self-service consent & data deletion (DPDP).

## Phase 6 — Marketing Automation 🔑
| Feature | Status |
|---|---|
| Campaigns + automations (birthday, win-back, inactive, reward unlock, progress, occasion) | ✅ |
| Consent-only audiences, 24 h frequency cap, monthly plan limits, dedupe | ✅ |
| D1 outbox + cron delivery with retries; webhook statuses; STOP → opt-out | ✅ |
| Actual WhatsApp delivery | 🔑 WhatsApp Cloud API credentials + Meta-approved templates |

## Phase 7 — Analytics ✅
Customers, new/returning, visits (daily/weekly/monthly), points, rewards unlocked/redeemed, retention; advanced (plan-gated): programs, channels, QR/NFC, failures, duplicates, device incompatibility. Review analytics on the AI Review Assistant page.

## Phase 8 — SaaS Management 🔑
| Feature | Status |
|---|---|
| Plans with editable limits (Free/Starter/Professional/Agency), enforced across modules | ✅ |
| Razorpay Orders + Checkout, signature verification, webhook, idempotent activation, expiry cron | 🔑 Razorpay keys (tested with mocks) |
| Super Admin: overview, businesses, subscriptions (+ manual grants), revenue, AI usage/cost, transactions, suspicious activity, plans, settings, system health | ✅ |

## UX — Landing page & user flow ✅
| Feature | Status |
|---|---|
| Public landing page `/` (hero with demo card, how-it-works tabs for owners & customers, features, labelled review example, live pricing, FAQ) | ✅ |
| Public pricing API `GET /api/public/plans` (cached 5 min) | ✅ tested |
| 3-step onboarding wizard (shop → category-based stamp-card template with live preview → QR poster download) | ✅ |
| Overview setup checklist with progress bar and scanner shortcut | ✅ |
| Grouped dashboard navigation with icons and a persistent "Scan customer card" button | ✅ |
| Customer "Join → Show card → Get reward" explainer on the business page | ✅ |
| "Find your shop on Google" autofill via Places API (New): onboarding, Shop settings, and Google review-link finder; review link pre-filled from place id | ✅ live (tested with mocks + verified on production) |
| Review keywords: AI suggestions from shop details + Google listing facts, owner's own keywords, onboarding "Google reviews" step, keyword manager | ✅ live (verified with real Workers AI + Places) |
| ⭐ review button under the loyalty card → rating + keyword chips → 3 AI drafts → copy + open Google review page | ✅ live. Google can't pre-fill its review box, so the draft is copied for the customer to paste |
| Google Wallet loyalty pass: save link, live stamp updates, static wallet QR accepted at the counter with mobile check before redeeming | ✅ live (23 Nov 2026): class + object created on Google, stamp update verified on Google's side. Issuer in **demo mode** — only console users/test accounts can save until Google approves publishing. Official button artwork still to add |
| Customer card installable to home screen (PWA: manifest, icons, no-cache service worker with offline page; native prompt on Android Chrome, step-by-step guide on iPhone / other browsers) | ✅ live — needs real-device check. iPhone home-screen apps keep separate storage, so the customer enters their mobile number once there |
| Apple Wallet | ❌ not implemented (needs Apple Developer account + Pass Type ID certificate) |
| Real-device / cross-browser visual QA | ⏳ not yet done |

## Known limitations
- No auto-renewing subscriptions (each payment buys 30 days; no proration).
- Email verification not required at sign-up.
- OTP is off: anyone who knows a customer's mobile number can open that customer's cards and show their reward QR. Turn on `CUSTOMER_OTP=on` with Twilio before scaling up.
- No Content-Security-Policy header yet.

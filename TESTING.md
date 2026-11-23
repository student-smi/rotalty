# Testing

```bash
npm test            # 152 tests, 14 files, run inside workerd via @cloudflare/vitest-plugin
npm run typecheck
```

Requests go through the full Worker (`exports.default.fetch`) with real local D1 and the Rate Limiting binding; migrations are applied in `test/setup.ts`. Tests run offline (`remoteBindings: false`): the Workers AI binding is replaced by a stub on `env.AI`, external APIs (Gemini, WhatsApp, Razorpay) are mocked with `vi.spyOn(globalThis, "fetch")`, and their secrets are injected by setting them on the `env` object from `cloudflare:workers` (shared with the Worker in the test isolate) and removed after each test.

## Coverage

| File | Covers |
|---|---|
| auth | PBKDF2 hashing, sessions, role can't be self-assigned, sign-up kill switch |
| business | Registration, validation, slugs, locations, logo upload (D1) |
| tenant-isolation | Cross-business access to profile, locations, staff, invitations |
| staff | Invitations, permissions, owner-only permissions, disabling |
| admin, admin-platform | Suspension, plans editing, subscriptions grants, revenue, AI usage, suspicious activity, settings, health |
| loyalty | Program validation & plan limits, issuance, **daily limit under concurrency**, idempotency, cooldown, inactive programs, blocked cards, reward unlock, **race-safe redemption**, tenant isolation, staff permissions, location pinning |
| qr-nfc | Rotating QR single-use, tampered/expired/forged tokens, cross-business tokens, QR channel switch, printed QR rotate/revoke/redirects, NFC plan gating, phone-to-phone rejected, **tag tap never issues points**, staff approval flow, expiry/rejection, revoked & foreign tags |
| customer | Join, multi-business cards, existing-number protection, consent capture, plan customer limit, OTP recovery, enumeration protection, OTP rate limits, privacy, data deletion |
| reviews | URL validation, permissions, Workers AI (JSON mode, string/object responses, AI Gateway option, wrong-script rejection, error mapping, missing binding) and Gemini success/failure/invalid output/rate limit, missing key, regeneration & plan limits, redirect tracking, independence from loyalty |
| crm | Segments, search, isolation, CSV export permission & injection escaping, consent rules, card blocking |
| marketing | Plan gating, WhatsApp not configured, consent-only audiences, limits, frequency cap, outbox retries, webhook verification/statuses/STOP, birthday dedupe, reward-unlock automation |
| analytics, billing | Exact metrics, plan gating, Razorpay checkout/verify/webhook signatures, idempotency, renewal, expiry |

## Production smoke test (2026-11-23)

Owner sign-up → business → program → public page → customer join → rotating QR → scan issues 1 point → replay rejected (`DUPLICATE`) → printed QR redirect → analytics & CRM show the visit → NFC blocked on Free plan → checkout reports `PAYMENTS_UNAVAILABLE` (no keys).

## Not yet tested — required before launch
- UI click-through on real phones (Android Chrome, iPhone Safari) and desktop.
- Camera QR scanning on real devices.
- NFC tag writing and tapping on real hardware (Android + iPhone).
- Real Workers AI output quality in Hindi/Gujarati; real Gemini, WhatsApp, Razorpay and Twilio calls with live credentials.

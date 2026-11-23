# Graahak — Local Business Growth Platform

Multi-tenant SaaS for Indian local businesses: digital loyalty cards (QR + NFC tags), a Cloudflare Workers AI–powered Google review helper, CRM, WhatsApp automation, analytics, and subscription billing — running entirely on Cloudflare Workers + D1.

**Live:** https://loyalty-review-platform.smitpanchal734.workers.dev
**Status:** all 8 phases built — see [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md) for exactly what is complete, what needs API keys, and what still needs device testing.

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars        # set BETTER_AUTH_SECRET
npm run db:migrate:local
npm run dev                           # http://localhost:5173
npm test
```

Make yourself Super Admin (use `--remote` for production):

```bash
npx wrangler d1 execute DB --local --command "UPDATE users SET role='super_admin' WHERE email='you@example.com'"
```

## Where things are

| Who | URL |
|---|---|
| Visitor | `/` landing page (how it works, features, live pricing from `/api/public/plans`, FAQ) |
| New owner | `/signup` → `/app/onboarding` (3-step wizard: shop → stamp card → printable QR poster) |
| Business owner / staff | `/app` (dashboard), `/app/b/:id/scan` (counter scanner) |
| Customer | `/s/:slug` (business page & join), `/c` (my cards), `/s/:slug/review` (review assistant) |
| Super Admin | `/admin` |

## User flow

1. **Owner** signs up → onboarding wizard creates the shop, a ready-made stamp card for their category (editable stamps, reward, icon) and downloads the counter QR poster — about 5 minutes.
2. **Overview** shows a setup checklist with progress (stamp card, poster, logo, address, Google review helper) and an *Open scanner* shortcut.
3. **Customer** scans the poster → `/s/:slug` explains *Join → Show card → Get reward* → joins with name + phone, no app.
4. **Staff** taps *Scan customer card* (always visible in the sidebar / mobile header) → adds a stamp or redeems a reward.

Dashboard navigation is grouped as **Today** (Overview, Scan & Issue), **Loyalty** (Stamp cards, QR posters & NFC, Rewards), **Grow** (Customers, Google reviews, WhatsApp marketing, Analytics) and **Account** (Team, Shop settings, Plan & billing). The brand name lives in `src/client/lib/brand.tsx`.

## Documentation

[ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [API](API_DOCUMENTATION.md) · [CLOUDFLARE_SETUP](CLOUDFLARE_SETUP.md) · [ENVIRONMENT_VARIABLES](ENVIRONMENT_VARIABLES.md) · [DEPLOYMENT](DEPLOYMENT.md) · [TESTING](TESTING.md) · [DEVELOPMENT_PROGRESS](DEVELOPMENT_PROGRESS.md)

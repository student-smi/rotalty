# Deployment

First complete [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md) (D1 id in `wrangler.jsonc`, secrets, production `vars`).

```bash
npm ci
npm test                       # must pass
npm run db:migrate:remote      # apply pending migrations to production D1
npm run deploy                 # type-check, build, wrangler deploy
```

Then create the first Super Admin:

```bash
npx wrangler d1 execute DB --remote --command "UPDATE users SET role='super_admin' WHERE email='admin@yourdomain.com'"
```

## Release checklist

- [ ] `APP_ENV=production` and `BETTER_AUTH_URL` set to the real HTTPS origin
- [ ] `database_id` in `wrangler.jsonc` is the real D1 id
- [ ] `BETTER_AUTH_SECRET` set (never reuse the dev value)
- [ ] Migrations applied **before** deploying code that depends on them
- [ ] Email provider configured, otherwise password reset emails are not delivered in production
- [ ] Turnstile configured for public sign-up

## Rollback

`npx wrangler rollback` reverts the Worker code. D1 migrations are forward-only, so write additive migrations and avoid destructive schema changes in the same release as code changes. D1 Time Travel can restore the database to a point in time if needed.

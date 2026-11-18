# Silverback Metrics

Silverback-owned lead tracking and client reporting for Silverback Web clients. One snippet on the site, an Elementor webhook on each form, and clients log in to see every lead, where it came from, and what it was worth.

- **Plan:** [docs/PLAN.md](docs/PLAN.md)
- **Team setup checklist:** [docs/ONBOARDING.md](docs/ONBOARDING.md)

## What's in this scaffold

| Path | What it is |
|---|---|
| `public/t.js` | The tracking snippet (working, tested): visitor ID, first/last touch, UTMs and click IDs, fills `sb_data` hidden fields, beacons |
| `src/app/api/collect` | Beacon endpoint for the snippet |
| `src/app/api/ingest/elementor/[siteKey]` | Elementor Pro Forms webhook target |
| `src/lib/attribution.ts` | Channel rules (Google Ads, GBP, organic, etc.) |
| `src/lib/elementor.ts` | Elementor payload parser and spam scoring |
| `worker.ts`, `wrangler.jsonc` | Cloudflare Worker entry and config, including the cron triggers |
| `src/app/login`, `src/app/setup`, `src/lib/session.ts`, `src/lib/access.ts` | Email + password logins, first-admin setup, and per-client access rules |
| `src/app/page.tsx` | Team home: every client with leads this month and tracking health |
| `src/app/c/[clientId]` | Client dashboard: Overview, Leads, lead detail (journey, status, value, change log), team-only Setup |
| `src/app/clients/new` | Add a client: creates its site key and Elementor webhook URL |
| `drizzle/` | SQL migrations |
| `src/db/schema.ts` | Postgres schema (Drizzle) for clients, sites, touches, leads, synced metrics, rankings, heat maps |

## Run locally

Runs free on **Cloudflare Workers** (Next.js via the OpenNext adapter) with **Postgres on Neon**.

Local development:

```bash
cp .env.example .env      # paste a Neon dev-branch DATABASE_URL
npm install
npm run db:generate && npm run db:migrate
npm run dev               # normal Next.js dev server
npm test
```

Deploy:

```bash
npx wrangler login
npx wrangler secret put DATABASE_URL     # and AUTH_SECRET, SETUP_KEY, CRON_SECRET, APP_URL
npm run deploy                           # builds with OpenNext and deploys the Worker
```

Create the database tables (run once, and again whenever `drizzle/` gets a new migration):

```bash
DATABASE_URL="<neon connection string>" npm run db:migrate
```

Then open `/setup`, enter the `SETUP_KEY`, and create the first Silverback admin login. That page switches itself off once an admin exists.

Then add the custom domain (for example `metrics.silverbackweb.com`) under the Worker's **Settings → Domains & Routes** in Cloudflare.

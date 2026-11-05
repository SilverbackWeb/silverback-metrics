# Silverback Metrics

Self-hosted lead tracking and client reporting for Silverback Web clients. One snippet on the site, an Elementor webhook on each form, and clients log in to see every lead, where it came from, and what it was worth.

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
| `src/db/schema.ts` | Postgres schema (Drizzle) for clients, sites, touches, leads, synced metrics, rankings, heat maps |

## Run locally

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run db:generate && npm run db:migrate
npm run dev
npm test
```

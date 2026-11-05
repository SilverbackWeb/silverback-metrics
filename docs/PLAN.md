# Silverback Metrics: Architecture and Build Plan

A self-hosted, multi-client lead tracking and reporting dashboard. Think "WhatConverts, but ours": one line of code on a client site, a few connected Google accounts, and the client logs in to see every lead, where it came from, and what it was worth.

---

## 1. The goal in one paragraph

Every lead (form fill or phone call) gets stored with its full source story: the UTM tags, the Google Ads click ID, the referrer, the landing page, and the first and last way that visitor found the site. We then line those leads up against what the client spent (Google Ads), what they saw (GA4, Search Console, Google Business Profile), and where they rank (DataForSEO rankings and local heat maps). The client sees one clean dashboard, built the way Silverback wants it to look, with no Looker Studio, Octoboard, or Search Atlas report builder in the way.

## 2. What we are building (and not building)

**In scope**

- A tracking snippet (`t.js`) that runs on every client site.
- A lead inbox per client: forms (Elementor webhook first), and calls later.
- Attribution: channel, source, campaign, keyword, first touch, last touch.
- Lead value: mark leads as qualified, spam, won, and enter a dollar value.
- Integrations: Google Ads, GA4, Search Console, Google Business Profile, DataForSEO.
- Client logins with their own view, agency logins that see everything.
- A setup checklist and a "Verify" screen so the team can confirm a site works.

**Not in scope (at least for MVP)**

- A drag-and-drop report builder. We design the reports in code, on purpose. That is the whole reason this beats Data Studio and Octoboard: the reports look how *you* want, every client gets the same polished layout, and nobody fiddles with widgets.
- Our own analytics replacement. GA4 remains the source for traffic numbers; we only track what we need for lead attribution.
- A CRM. We track lead status and value, not a sales pipeline.

## 3. How the pieces fit

```
   Client website (WordPress + Elementor)
   ┌───────────────────────────────────────────┐
   │ <script src=".../t.js" data-site="KEY">   │──(1) pageviews, touches, tel: clicks──┐
   │ Elementor form + hidden field "sb_data"   │                                        │
   │   └─ Webhook action ──────────────────────┼──(2) lead + attribution JSON ──────┐   │
   └───────────────────────────────────────────┘                                     ▼   ▼
                                                                         ┌─────────────────────┐
   CallRail / GHL / Twilio (phase 3) ─────(3) call webhooks───────────▶│  Silverback Metrics │
                                                                         │  Next.js app + API  │
   Google Ads API ◀──┐                                                   │  Postgres           │
   GA4 Data API   ◀──┤                                                   │  Worker (pg-boss)   │
   Search Console ◀──┼──── (4) nightly sync jobs (worker) ───────────────│                     │
   GBP Performance◀──┤                                                   └──────────┬──────────┘
   DataForSEO     ◀──┘                                                              │
                                                                                    ▼
                                                    Agency team + client logins (dashboard)
```

1. **Snippet** records visits and remembers where each visitor came from.
2. **Form webhook** sends the lead, plus the attribution the snippet put in a hidden field.
3. **Calls** (later) arrive from Twilio or CallRail webhooks.
4. **Sync jobs** pull spend, traffic, visibility and ranking data every night.

## 4. Recommended stack

| Piece | Pick | Why |
|---|---|---|
| App + API | **Next.js (App Router) + TypeScript** | One codebase for the dashboard, the tracking endpoints and the webhooks. Huge ecosystem, easy to hire for. |
| Database | **PostgreSQL 16** | Relational data (clients, sites, leads) plus JSONB for raw payloads. One database to back up. |
| ORM | **Drizzle** | Typed SQL, lightweight, plain migrations. |
| Auth | **Auth.js (NextAuth)** with email magic links + Google sign-in for staff | Clients just get a login link; no password resets to support. |
| Background jobs | **pg-boss** (job queue inside Postgres) | Nightly API syncs and heat map scans without adding Redis. |
| Charts / UI | **Tailwind + shadcn/ui + Recharts**, **Leaflet** for heat maps | Clean, brandable, fast to build. |
| Email | **Resend** or Postmark | New lead alerts, weekly client summaries. |
| Hosting | **One VPS (Hetzner or DigitalOcean, ~$12 to $24/mo) with Docker Compose**, ideally managed by **Coolify** | "Self-hosted" without babysitting servers. Coolify gives one-click deploys from GitHub, SSL and backups. |
| Domain | `metrics.silverbackweb.com` for the app, optionally `t.silverbackweb.com` for tracking | White-labeled for clients. |

Ballpark running cost for MVP: the VPS plus DataForSEO usage. Google APIs are free.

## 5. The tracking snippet (the "WhatConverts" part)

### Install

```html
<script async src="https://metrics.silverbackweb.com/t.js" data-site="SITE_KEY"></script>
```

Paste it in the site header (Elementor → Custom Code, or WPCode). That is the only code change on the site. `SITE_KEY` comes from the client's page in the dashboard.

### What it does

1. **Gives each visitor an ID** (`vid`) stored in a first-party cookie and localStorage.
2. **Records the "touch"** whenever someone arrives with campaign info or from another website:
   - `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
   - click IDs: `gclid`, `gbraid`, `wbraid` (Google Ads), `fbclid`, `msclkid`
   - `document.referrer` and the landing page URL
3. **Keeps a first touch and a last touch.** The first touch never changes. The last touch updates only for non-direct visits, so someone who clicks an ad, leaves, and comes back by typing the URL is still credited to the ad.
4. **Fills hidden form fields.** Any field named `sb_data` (Elementor: hidden field with ID `sb_data`) gets the visitor ID and both touches as compact JSON. It also fills optional individual hidden fields (`utm_source`, `gclid`, and so on) if they exist. It watches the page, so Elementor popups get filled too.
5. **Sends lightweight beacons** to `/api/collect`: pageviews, phone link clicks (`tel:`), and a backup copy of form submissions in case a webhook is missing.
6. **Grabs the GA4 client ID** from the `_ga` cookie so a lead can be matched to GA4 data later.

### Honest limits

- Safari caps JavaScript-set cookies at 7 days. localStorage helps, but long sales cycles can still lose the first touch on iPhones. Phase 4 fixes this by serving the snippet from a subdomain of the client's own site (for example `t.clientsite.com` CNAME), so cookies are set by the server and last much longer.
- Ad blockers may block the beacons. That is why the **form webhook is the source of truth**: it goes server to server and can't be blocked, and the attribution rides inside the form itself.
- No iframes. GHL and Jotform iframes can't be read by the snippet, which is exactly the pain you described. Moving to Elementor forms solves it.

## 6. Lead capture

### Elementor forms (MVP)

Per form, the team does this once (it goes in the onboarding checklist):

1. Add a **Hidden** field, set its **ID** (Advanced tab) to `sb_data`.
2. Under **Actions After Submit**, add **Webhook**.
3. Webhook URL: `https://metrics.silverbackweb.com/api/ingest/elementor/SITE_KEY?token=INGEST_TOKEN` (copied from the dashboard).
4. Turn on **Advanced Data** in the webhook settings.

The endpoint:

- Checks the site key and token (Elementor can't sign requests, so the token in the URL is the shared secret; it can be rotated per site).
- Parses either Advanced Data or simple mode payloads.
- Finds name, email, phone and message by field type and label.
- Reads `sb_data` to get the visitor ID, first touch and last touch.
- Classifies the channel (section 8), flags likely spam, saves the lead, and emails the alert.
- Dedupes against the snippet's backup copy of the same submission.

**Bonus:** keep Elementor's own Email action too, so the client still gets the normal email.

### Other forms

The snippet's backup capture records submissions from any normal HTML form (Gravity, WPForms, Contact Form 7). A generic JSON webhook endpoint (`/api/ingest/webhook/SITE_KEY`) handles anything else, including Zapier. GHL and Jotform iframes stay unsupported unless we pass the attribution in the iframe URL, which is fiddly, so we don't plan for it.

### Calls (phase 3, optional per client)

Two levels:

1. **Static source numbers (simple, cheap):** buy one Twilio number per source, for example "GBP listing", "Google Ads", "Website". Put the GBP number on the profile and the Ads number in call assets. Twilio forwards to the client and posts call details (caller, duration, recording) to `/api/ingest/twilio`. Each call is a lead with a known source.
2. **Dynamic number insertion (WhatConverts-style):** the snippet swaps the phone number on the site for one from a pool, per visitor, so each website call ties back to that visitor's UTMs and keyword. Needs a pool of numbers per site (roughly 4 to 10 depending on traffic), so it costs more per client. Offer it as an upsell.

**Start with what clients already have (decided):** clients today use a mix of **CallRail** and **GoHighLevel** phone numbers, so phase 3 begins with ingesting those, not buying our own numbers:

- **CallRail:** a post-call webhook per client account to `/api/ingest/callrail/SITE_KEY`. CallRail already does number swapping and sends the source, landing page, UTMs and gclid it saw, so those calls arrive fully attributed. If a client's site runs both CallRail's swap script and ours, we also match on the visitor's session.
- **GoHighLevel:** a GHL workflow ("Call Status" trigger, then a Webhook action) posts each inbound call to `/api/ingest/ghl/SITE_KEY`. Attribution is whatever GHL knows about that number (for example the GBP number or the Ads number), so we map each GHL number to a source in the client settings.
- **Twilio (our own numbers)** becomes the option for clients with neither, and for dynamic number insertion later.

## 7. Integrations

| Source | What we pull | How we connect | Notes |
|---|---|---|---|
| **Google Ads** | Spend, clicks, impressions, conversions by campaign, ad group and keyword (daily). Click lookups (`click_view`) to turn a lead's `gclid` into campaign, ad group and keyword. | One OAuth connection to the **Silverback MCC (manager account)**; each client is a customer ID under it. | Needs a Google Ads **developer token** (apply early: Basic access takes days to a few weeks). `click_view` only works for clicks in the last 90 days and must be queried one day at a time, so we look up gclids nightly. |
| **Google Ads (outbound)** | Send qualified and won leads back to Ads as **offline conversions** with their value. | Same connection. | This is the big win: Ads starts optimizing for real leads, not form spam. Phase 3. |
| **GA4** | Sessions, users, engaged sessions, conversions by channel and landing page. | A Silverback **service account** added as Viewer on each client property. | You enter the **property ID** (numbers) for reporting and the **measurement ID** (`G-XXXX`) for reference. The snippet can also push a `generate_lead` event to GA4 if gtag is on the page. |
| **Search Console** | Clicks, impressions, average position, top queries and pages. | Same service account added as a user on each property. | Good "SEO is working" story next to rankings. |
| **Google Business Profile** | Calls, website clicks, direction requests, impressions (Maps and Search). | OAuth as the Silverback account that manages the profiles. | The Business Profile Performance API needs an **access request** to Google; apply early. Website clicks from GBP also show up as leads, because of the UTM link (section 9). |
| **DataForSEO** | Keyword rankings (Google organic and Maps), and **local heat maps**. | Your existing API login, stored encrypted. | See below. |

### Local heat maps with DataForSEO

A heat map is a grid of points around the business (for example 7x7 over 5 miles). For each keyword and each point we ask DataForSEO's Google Maps SERP endpoint "what ranks here" using that point's GPS coordinates, then find the client's listing by its Google CID or place ID and record the rank. We draw the grid on a Leaflet map, colored green (top 3), yellow (4 to 10), red (11+ or not found).

Cost scales with grid size times keywords times frequency. A 7x7 grid is 49 lookups per keyword per scan. Using the standard (queued) API rather than live is much cheaper, and monthly scans are plenty. Check DataForSEO's current price sheet before picking defaults; we'll make grid size, radius and frequency a per-client setting so you control the spend.

## 8. Attribution and lead value

### Channel rules (first match wins)

| Channel | Rule |
|---|---|
| Google Ads | `gclid`/`gbraid`/`wbraid` present, or `utm_source=google` and `utm_medium` in `cpc, ppc, paid` |
| Google Business Profile | `utm_medium=gbp` or `utm_campaign` starts with `gbp` (from our standard GBP links) |
| Paid Social | `fbclid`, or `utm_medium` in `paid_social, paidsocial, cpm` |
| Microsoft Ads | `msclkid` |
| Email | `utm_medium=email` |
| Other campaign | any other UTMs present |
| Organic Search | referrer is Google, Bing, Yahoo, DuckDuckGo |
| Organic Social | referrer is Facebook, Instagram, LinkedIn, YouTube, Nextdoor and so on |
| Referral | any other outside website |
| Direct | nothing at all |

These rules live in one file (`src/lib/attribution.ts`), have unit tests, and can grow over time.

### Models shown in the dashboard

- **Last non-direct touch** (default). Matches how clients think: "what brought this lead in?"
- **First touch.** Shows what started the relationship (often SEO or GBP).
- Every lead also stores its raw touches, so we can add other models later without re-collecting data.

### Lead value

- Each client has default values, for example "a form lead is worth $150, a call over 60 seconds is worth $200".
- The client (or team) can mark each lead **Qualified, Not a lead / Spam, Won, Lost**, and enter a **sale amount**.
- Dashboard shows: leads, qualified leads, cost per lead and cost per qualified lead (from Ads spend), won revenue, and ROI by channel and by campaign.

## 9. UTM conventions (so the data is clean)

| Placement | URL or setting |
|---|---|
| GBP website link | `https://client.com/?utm_source=google&utm_medium=gbp&utm_campaign=gbp-listing` |
| GBP appointment link | `https://client.com/contact/?utm_source=google&utm_medium=gbp&utm_campaign=gbp-appointment` |
| GBP posts | `...?utm_source=google&utm_medium=gbp&utm_campaign=gbp-post&utm_content=<post-name>` |
| Google Ads | Auto-tagging **on** (gives `gclid`), plus account-level **Final URL suffix**: `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}` |
| Facebook / Meta ads | URL parameters: `utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}` |
| Email / newsletter | `utm_source=newsletter&utm_medium=email&utm_campaign=<month-name>` |

The dashboard will include a small UTM builder so the team never types these by hand. Campaign IDs from Ads are translated into names using the Ads API, so reports show names, not numbers.

## 10. Clients, users and permissions

- **Clients** own **sites** (usually one; multi-location businesses can have several) and **integrations**.
- **Users** belong to clients through memberships with a role:
  - `agency_admin`: everything, all clients, settings and billing.
  - `agency_staff`: all clients, no settings that cost money (DataForSEO limits).
  - `client_owner`: their client only; can invite their own staff, edit lead status and value.
  - `client_viewer`: their client only, read-only.
- Every query is scoped by `client_id` in a single data-access layer, and we add Postgres row-level security as a second lock in phase 2.
- White label: Silverback logo and colors by default, per-client logo on their dashboard.

## 11. Dashboard pages

**Client view**

1. **Overview:** leads this month vs last, by channel; cost per lead; top campaigns; GBP actions; a simple "Leads over time" chart.
2. **Leads:** inbox table with source, channel, campaign/keyword, landing page, status and value; click a lead to see its full journey.
3. **Google Ads:** spend, clicks, leads, cost per lead, by campaign and keyword, using *our* leads, not just Ads-reported conversions.
4. **SEO:** Search Console trends, keyword rankings, organic leads.
5. **Local:** GBP actions and the heat map.
6. **Monthly report:** a print/PDF-ready version of the above with a written summary box the team fills in.

**Agency view**

- All clients at a glance: leads this month, last lead received, "tracking health" (snippet seen in last 24h, webhook working, integrations connected, sync errors).
- Client setup pages: site key, snippet, webhook URL, integrations, lead values.
- **Verify** screen per site (section 12).

## 12. Team setup checklist and the Verify screen

The step-by-step version for the team is in [`docs/ONBOARDING.md`](./ONBOARDING.md). The app will mirror it as a checklist on each client's setup page, and the **Verify** screen checks automatically:

- Snippet loaded on the site in the last 24 hours (and on which pages).
- A test lead arrived with attribution attached (team submits the form with `?utm_source=test` on the URL).
- The `sb_data` hidden field is present (the snippet reports when it finds and fills one).
- GA4, Search Console, Ads and GBP connections return data.
- Google Ads has auto-tagging on and the Final URL suffix set (read from the Ads API).
- GBP website link contains our UTMs (read from the GBP API).

Each line is green, yellow or red with a "how to fix" link.

## 13. Data model (first cut)

Defined in [`src/db/schema.ts`](../src/db/schema.ts):

- `users`, `clients`, `memberships`
- `sites` (site key, ingest token, domain, client)
- `integrations` (client, kind, external IDs, encrypted credentials, last sync status)
- `visitors` (site, first touch, last touch, GA client ID)
- `touches` (every attributed arrival: UTMs, click IDs, referrer, landing page, channel)
- `events` (pageviews, phone clicks, backup form submissions)
- `leads` (site, client, visitor, type, contact fields, status, value, channel, first/last touch, Ads campaign/keyword once resolved, raw payload)
- `ads_daily`, `ga4_daily`, `gsc_daily`, `gbp_daily` (nightly synced metrics)
- `rank_keywords`, `rank_results`, `heatmap_scans`, `heatmap_points`

## 14. Privacy and security

- Leads contain personal info, so: HTTPS everywhere, encrypted backups, API credentials encrypted at rest, and a data retention setting per client (for example raw events kept 13 months).
- The snippet stores no personal info in cookies, only a random ID and campaign data.
- A cookie consent hook: if a client uses a consent banner, the snippet can wait for consent before setting its ID.
- Add a short line to each client's privacy policy about lead source tracking.

## 15. Roadmap

### Phase 1: MVP, "leads with sources" (about 3 to 4 weeks of build)

- Snippet (`t.js`), collect endpoint, Elementor webhook ingest, generic webhook.
- Attribution rules and lead storage, spam flagging, new lead email alerts.
- Agency login, client logins, client and site setup pages.
- Lead inbox and Overview page (leads by channel, source, campaign, landing page).
- Lead status and value editing.
- Deployed on the VPS, tested on 2 to 3 friendly client sites.

**Done when:** a team member can set up a new site with the checklist in under 30 minutes and the client sees attributed leads the same day.

### Phase 2: "what it cost and what it got" (about 3 weeks)

- Google Ads sync (spend by campaign and keyword) and gclid to keyword lookup.
- GA4 and Search Console sync.
- Cost per lead and ROI by channel.
- Verify screen with automatic checks.
- Monthly PDF report.

### Phase 3: Local and calls (about 3 to 4 weeks)

- GBP Performance sync and GBP link check.
- DataForSEO rankings and heat maps.
- Call leads from CallRail and GoHighLevel webhooks (number to source mapping per client); Twilio static numbers for clients with neither.
- Offline conversion upload back to Google Ads.

### Phase 4: Polish and upsells

- Dynamic number insertion.
- First-party subdomain tracking for longer cookie life.
- Weekly email summaries to clients, Slack alerts for the team.
- CallRail ingest, Meta Ads spend, more attribution models.

### Start these now (they have waiting periods)

1. Apply for a **Google Ads API developer token** from the Silverback MCC.
2. Request **Business Profile API** access in Google Cloud.
3. Create a Google Cloud **service account** for GA4 and Search Console.
4. Decide the app domain (for example `metrics.silverbackweb.com`) and pick the VPS.

## 16. Decisions from Mike

**Decided:** the app is for Silverback only (single agency). No multi-agency layer, no billing or sign-up flows; agency staff are simply users flagged `is_agency`.

**Decided:** clients can edit their own leads (status, lead value, sale amount). Every change is logged with who made it and when, and the team can still override.

**Decided:** call tracking ingests what clients already use (CallRail or GoHighLevel) first; our own Twilio numbers are the fallback.

**Decided:** heat maps and rank checks run **monthly** by default (7x7 grid, 5 mile radius), adjustable per client. Budget is roughly grid points x keywords per client per month.

/**
 * First-cut data model. See docs/PLAN.md section 13.
 * Every client-facing query must be scoped by clientId (see src/db/scope.ts, phase 1).
 */
import {
  pgTable, pgEnum, uuid, text, timestamp, jsonb, integer, boolean, date, numeric,
  index, uniqueIndex, primaryKey, doublePrecision,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["agency_admin", "agency_staff", "client_owner", "client_viewer"]);
export const leadTypeEnum = pgEnum("lead_type", ["form", "call", "chat", "other"]);
export const leadStatusEnum = pgEnum("lead_status", ["new", "qualified", "spam", "won", "lost"]);
export const integrationKindEnum = pgEnum("integration_kind", ["ga4", "gsc", "google_ads", "gbp", "dataforseo", "twilio", "callrail", "ghl"]);

const created = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

// ---------- people and tenants ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  isAgency: boolean("is_agency").default(false).notNull(), // agency staff see all clients
  agencyRole: roleEnum("agency_role"),
  createdAt: created(),
});

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  website: text("website"),
  logoUrl: text("logo_url"),
  timezone: text("timezone").default("America/Chicago").notNull(),
  defaultFormValueCents: integer("default_form_value_cents").default(0).notNull(),
  defaultCallValueCents: integer("default_call_value_cents").default(0).notNull(),
  minCallSecondsForLead: integer("min_call_seconds_for_lead").default(60).notNull(),
  clientsCanEditLeads: boolean("clients_can_edit_leads").default(true).notNull(),
  createdAt: created(),
});

export const memberships = pgTable("memberships", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.userId, t.clientId] })]);

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  siteKey: text("site_key").notNull().unique(),       // public, goes in the snippet
  ingestToken: text("ingest_token").notNull(),         // secret, goes in the webhook URL
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastFieldSeenAt: timestamp("last_field_seen_at", { withTimezone: true }),
  createdAt: created(),
});

export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  kind: integrationKindEnum("kind").notNull(),
  externalId: text("external_id"),       // GA4 property ID, Ads customer ID, GBP location name, GSC site URL
  config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(), // e.g. measurementId, heat map grid
  credentialsEnc: text("credentials_enc"), // encrypted; agency-level creds live in env
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  createdAt: created(),
}, (t) => [uniqueIndex("integrations_client_kind_ext").on(t.clientId, t.kind, t.externalId)]);

// ---------- tracking ----------

export const visitors = pgTable("visitors", {
  id: uuid("id").primaryKey(),            // vid from the snippet
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  gaClientId: text("ga_client_id"),
  firstTouchId: uuid("first_touch_id"),
  lastTouchId: uuid("last_touch_id"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

export const touches = pgTable("touches", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  visitorId: uuid("visitor_id").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  channel: text("channel").notNull(),
  landing: text("landing"),
  referrer: text("referrer"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmTerm: text("utm_term"),
  utmContent: text("utm_content"),
  gclid: text("gclid"),
  gbraid: text("gbraid"),
  wbraid: text("wbraid"),
  fbclid: text("fbclid"),
  msclkid: text("msclkid"),
}, (t) => [index("touches_visitor").on(t.visitorId, t.ts), index("touches_gclid").on(t.gclid)]);

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  visitorId: uuid("visitor_id").notNull(),
  sessionId: uuid("session_id"),
  type: text("type").notNull(), // pageview | tel_click | form_submit | field_found
  url: text("url"),
  title: text("title"),
  data: jsonb("data"),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("events_site_ts").on(t.siteId, t.ts), index("events_visitor").on(t.visitorId)]);

// ---------- leads ----------

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  visitorId: uuid("visitor_id"),
  type: leadTypeEnum("type").notNull(),
  source: text("source").notNull(), // elementor | webhook | snippet_backup | twilio | callrail | ghl
  status: leadStatusEnum("status").default("new").notNull(),
  spamReasons: jsonb("spam_reasons").$type<string[]>(),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  message: text("message"),
  formName: text("form_name"),
  pageUrl: text("page_url"),
  // attribution snapshot (denormalized for fast reports)
  channel: text("channel").notNull(),
  firstChannel: text("first_channel"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmTerm: text("utm_term"),
  utmContent: text("utm_content"),
  landingPage: text("landing_page"),
  referrer: text("referrer"),
  gclid: text("gclid"),
  gaClientId: text("ga_client_id"),
  firstTouch: jsonb("first_touch"),
  lastTouch: jsonb("last_touch"),
  // resolved from Google Ads click_view (phase 2)
  adsCampaignId: text("ads_campaign_id"),
  adsCampaignName: text("ads_campaign_name"),
  adsAdGroupName: text("ads_ad_group_name"),
  adsKeyword: text("ads_keyword"),
  // calls (phase 3)
  callDurationSec: integer("call_duration_sec"),
  recordingUrl: text("recording_url"),
  // value
  valueCents: integer("value_cents"),
  saleCents: integer("sale_cents"),
  offlineConversionSentAt: timestamp("offline_conversion_sent_at", { withTimezone: true }),
  raw: jsonb("raw"),
  createdAt: created(),
}, (t) => [
  index("leads_client_created").on(t.clientId, t.createdAt),
  index("leads_visitor").on(t.visitorId),
  index("leads_gclid").on(t.gclid),
]);

// ---------- synced metrics (phase 2-3) ----------

export const adsDaily = pgTable("ads_daily", {
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  campaignId: text("campaign_id").notNull(),
  campaignName: text("campaign_name"),
  impressions: integer("impressions").default(0).notNull(),
  clicks: integer("clicks").default(0).notNull(),
  costMicros: numeric("cost_micros", { mode: "bigint" }).default(0n).notNull(),
  conversions: doublePrecision("conversions").default(0).notNull(),
}, (t) => [primaryKey({ columns: [t.clientId, t.day, t.campaignId] })]);

export const ga4Daily = pgTable("ga4_daily", {
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  channelGroup: text("channel_group").notNull(),
  sessions: integer("sessions").default(0).notNull(),
  users: integer("users").default(0).notNull(),
  engagedSessions: integer("engaged_sessions").default(0).notNull(),
  keyEvents: doublePrecision("key_events").default(0).notNull(),
}, (t) => [primaryKey({ columns: [t.clientId, t.day, t.channelGroup] })]);

export const gscDaily = pgTable("gsc_daily", {
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  clicks: integer("clicks").default(0).notNull(),
  impressions: integer("impressions").default(0).notNull(),
  avgPosition: doublePrecision("avg_position"),
}, (t) => [primaryKey({ columns: [t.clientId, t.day] })]);

export const gbpDaily = pgTable("gbp_daily", {
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  location: text("location").notNull(),
  day: date("day").notNull(),
  calls: integer("calls").default(0).notNull(),
  websiteClicks: integer("website_clicks").default(0).notNull(),
  directionRequests: integer("direction_requests").default(0).notNull(),
  impressionsMaps: integer("impressions_maps").default(0).notNull(),
  impressionsSearch: integer("impressions_search").default(0).notNull(),
}, (t) => [primaryKey({ columns: [t.clientId, t.location, t.day] })]);

// ---------- rankings and heat maps (phase 3) ----------

export const rankKeywords = pgTable("rank_keywords", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  keyword: text("keyword").notNull(),
  locationCode: integer("location_code"), // DataForSEO location
  trackOrganic: boolean("track_organic").default(true).notNull(),
  trackMaps: boolean("track_maps").default(true).notNull(),
});

export const rankResults = pgTable("rank_results", {
  keywordId: uuid("keyword_id").notNull().references(() => rankKeywords.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  engine: text("engine").notNull(), // organic | maps
  position: integer("position"),     // null = not in results
  url: text("url"),
}, (t) => [primaryKey({ columns: [t.keywordId, t.day, t.engine] })]);

export const heatmapScans = pgTable("heatmap_scans", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  keywordId: uuid("keyword_id").notNull().references(() => rankKeywords.id, { onDelete: "cascade" }),
  centerLat: doublePrecision("center_lat").notNull(),
  centerLng: doublePrecision("center_lng").notNull(),
  gridSize: integer("grid_size").default(7).notNull(),
  radiusMiles: doublePrecision("radius_miles").default(5).notNull(),
  targetCid: text("target_cid"), // the client's Google Maps CID / place ID
  status: text("status").default("queued").notNull(),
  createdAt: created(),
});

export const heatmapPoints = pgTable("heatmap_points", {
  scanId: uuid("scan_id").notNull().references(() => heatmapScans.id, { onDelete: "cascade" }),
  row: integer("row").notNull(),
  col: integer("col").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  rank: integer("rank"), // null = not in top 20
}, (t) => [primaryKey({ columns: [t.scanId, t.row, t.col] })]);

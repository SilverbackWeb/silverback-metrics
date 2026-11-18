CREATE TYPE "public"."integration_kind" AS ENUM('ga4', 'gsc', 'google_ads', 'gbp', 'dataforseo', 'twilio', 'callrail', 'ghl');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'qualified', 'spam', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."lead_type" AS ENUM('form', 'call', 'chat', 'other');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('agency_admin', 'agency_staff', 'client_owner', 'client_viewer');--> statement-breakpoint
CREATE TABLE "ads_daily" (
	"client_id" uuid NOT NULL,
	"day" date NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"conversions" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "ads_daily_client_id_day_campaign_id_pk" PRIMARY KEY("client_id","day","campaign_id")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"logo_url" text,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"default_form_value_cents" integer DEFAULT 0 NOT NULL,
	"default_call_value_cents" integer DEFAULT 0 NOT NULL,
	"min_call_seconds_for_lead" integer DEFAULT 60 NOT NULL,
	"clients_can_edit_leads" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"visitor_id" uuid NOT NULL,
	"session_id" uuid,
	"type" text NOT NULL,
	"url" text,
	"title" text,
	"data" jsonb,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ga4_daily" (
	"client_id" uuid NOT NULL,
	"day" date NOT NULL,
	"channel_group" text NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	"engaged_sessions" integer DEFAULT 0 NOT NULL,
	"key_events" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "ga4_daily_client_id_day_channel_group_pk" PRIMARY KEY("client_id","day","channel_group")
);
--> statement-breakpoint
CREATE TABLE "gbp_daily" (
	"client_id" uuid NOT NULL,
	"location" text NOT NULL,
	"day" date NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"website_clicks" integer DEFAULT 0 NOT NULL,
	"direction_requests" integer DEFAULT 0 NOT NULL,
	"impressions_maps" integer DEFAULT 0 NOT NULL,
	"impressions_search" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "gbp_daily_client_id_location_day_pk" PRIMARY KEY("client_id","location","day")
);
--> statement-breakpoint
CREATE TABLE "gsc_daily" (
	"client_id" uuid NOT NULL,
	"day" date NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"avg_position" double precision,
	CONSTRAINT "gsc_daily_client_id_day_pk" PRIMARY KEY("client_id","day")
);
--> statement-breakpoint
CREATE TABLE "heatmap_points" (
	"scan_id" uuid NOT NULL,
	"row" integer NOT NULL,
	"col" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"rank" integer,
	CONSTRAINT "heatmap_points_scan_id_row_col_pk" PRIMARY KEY("scan_id","row","col")
);
--> statement-breakpoint
CREATE TABLE "heatmap_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"keyword_id" uuid NOT NULL,
	"center_lat" double precision NOT NULL,
	"center_lng" double precision NOT NULL,
	"grid_size" integer DEFAULT 7 NOT NULL,
	"radius_miles" double precision DEFAULT 5 NOT NULL,
	"target_cid" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"external_id" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_enc" text,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid,
	"user_name" text,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"site_id" uuid,
	"visitor_id" uuid,
	"type" "lead_type" NOT NULL,
	"source" text NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"spam_reasons" jsonb,
	"name" text,
	"email" text,
	"phone" text,
	"message" text,
	"form_name" text,
	"page_url" text,
	"channel" text NOT NULL,
	"first_channel" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"landing_page" text,
	"referrer" text,
	"gclid" text,
	"ga_client_id" text,
	"first_touch" jsonb,
	"last_touch" jsonb,
	"ads_campaign_id" text,
	"ads_campaign_name" text,
	"ads_ad_group_name" text,
	"ads_keyword" text,
	"call_duration_sec" integer,
	"recording_url" text,
	"value_cents" integer,
	"sale_cents" integer,
	"offline_conversion_sent_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "rank_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"location_code" integer,
	"track_organic" boolean DEFAULT true NOT NULL,
	"track_maps" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rank_results" (
	"keyword_id" uuid NOT NULL,
	"day" date NOT NULL,
	"engine" text NOT NULL,
	"position" integer,
	"url" text,
	CONSTRAINT "rank_results_keyword_id_day_engine_pk" PRIMARY KEY("keyword_id","day","engine")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"site_key" text NOT NULL,
	"ingest_token" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_field_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_site_key_unique" UNIQUE("site_key")
);
--> statement-breakpoint
CREATE TABLE "touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"visitor_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"channel" text NOT NULL,
	"landing" text,
	"referrer" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"gclid" text,
	"gbraid" text,
	"wbraid" text,
	"fbclid" text,
	"msclkid" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"is_agency" boolean DEFAULT false NOT NULL,
	"agency_role" "role",
	"password_hash" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "visitors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"ga_client_id" text,
	"first_touch_id" uuid,
	"last_touch_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ads_daily" ADD CONSTRAINT "ads_daily_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ga4_daily" ADD CONSTRAINT "ga4_daily_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_daily" ADD CONSTRAINT "gbp_daily_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_daily" ADD CONSTRAINT "gsc_daily_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heatmap_points" ADD CONSTRAINT "heatmap_points_scan_id_heatmap_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."heatmap_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heatmap_scans" ADD CONSTRAINT "heatmap_scans_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heatmap_scans" ADD CONSTRAINT "heatmap_scans_keyword_id_rank_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."rank_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_edits" ADD CONSTRAINT "lead_edits_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_edits" ADD CONSTRAINT "lead_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_keywords" ADD CONSTRAINT "rank_keywords_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_results" ADD CONSTRAINT "rank_results_keyword_id_rank_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."rank_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_site_ts" ON "events" USING btree ("site_id","ts");--> statement-breakpoint
CREATE INDEX "events_visitor" ON "events" USING btree ("visitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_client_kind_ext" ON "integrations" USING btree ("client_id","kind","external_id");--> statement-breakpoint
CREATE INDEX "lead_edits_lead" ON "lead_edits" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_client_created" ON "leads" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_visitor" ON "leads" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "leads_gclid" ON "leads" USING btree ("gclid");--> statement-breakpoint
CREATE INDEX "touches_visitor" ON "touches" USING btree ("visitor_id","ts");--> statement-breakpoint
CREATE INDEX "touches_gclid" ON "touches" USING btree ("gclid");
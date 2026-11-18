ALTER TABLE "clients" ADD COLUMN "gbp_places" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "heatmap_scans" ADD COLUMN "location" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "heatmap_scans" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "heatmap_scans" ADD COLUMN "error" text;
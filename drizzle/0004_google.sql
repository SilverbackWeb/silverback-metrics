CREATE TABLE "google_auth" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"refresh_token_enc" text NOT NULL,
	"scopes" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_top" (
	"client_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position" double precision,
	CONSTRAINT "gsc_top_client_id_kind_key_pk" PRIMARY KEY("client_id","kind","key")
);
--> statement-breakpoint
ALTER TABLE "ads_daily" ADD COLUMN "channel_type" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gsc_top" ADD CONSTRAINT "gsc_top_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
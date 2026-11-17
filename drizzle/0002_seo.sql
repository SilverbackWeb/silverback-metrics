CREATE TABLE "ranked_keywords" (
	"client_id" uuid NOT NULL,
	"day" date NOT NULL,
	"keyword" text NOT NULL,
	"position" integer NOT NULL,
	"url" text,
	"search_volume" integer,
	"etv" double precision,
	CONSTRAINT "ranked_keywords_client_id_day_keyword_pk" PRIMARY KEY("client_id","day","keyword")
);
--> statement-breakpoint
ALTER TABLE "rank_results" ADD COLUMN "location" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rank_results" DROP CONSTRAINT "rank_results_keyword_id_day_engine_pk";--> statement-breakpoint
ALTER TABLE "rank_results" ADD CONSTRAINT "rank_results_keyword_id_day_engine_location_pk" PRIMARY KEY("keyword_id","day","engine","location");--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "rank_locations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "gbp_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "rank_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "rank_check_error" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "ranked_snapshot_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rank_keywords" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rank_results" ADD COLUMN "checked_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ranked_keywords" ADD CONSTRAINT "ranked_keywords_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_keywords_client_kw" ON "rank_keywords" USING btree ("client_id","keyword");
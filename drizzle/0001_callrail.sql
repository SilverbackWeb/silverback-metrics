ALTER TABLE "leads" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_client_source_ext" ON "leads" USING btree ("client_id","source","external_id");
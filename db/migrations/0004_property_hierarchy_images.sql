ALTER TABLE "property" ADD COLUMN "project_name" text;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "project_name_normalized" text;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "building_name" text;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "building_name_normalized" text;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "house_number" text;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "house_number_normalized" text;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "aliases" jsonb;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "price_observation" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "ingest_message" ADD COLUMN "attachments" jsonb;--> statement-breakpoint
CREATE INDEX "property_project_name_norm_idx" ON "property" USING btree ("project_name_normalized");--> statement-breakpoint
CREATE INDEX "property_building_name_norm_idx" ON "property" USING btree ("building_name_normalized");--> statement-breakpoint
CREATE INDEX "property_house_number_norm_idx" ON "property" USING btree ("house_number_normalized");--> statement-breakpoint
CREATE INDEX "property_tags_idx" ON "property" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "obs_tags_idx" ON "price_observation" USING gin ("tags");

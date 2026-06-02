CREATE TYPE "public"."deal_status" AS ENUM('asking', 'transacted', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."listing_type" AS ENUM('sale', 'rent', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."location_level" AS ENUM('city', 'district', 'ward', 'street', 'zone');--> statement-breakpoint
CREATE TYPE "public"."price_basis" AS ENUM('total', 'per_m2', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."property_type" AS ENUM('apartment', 'house', 'project', 'land', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."signal_status" AS ENUM('pending', 'extracted', 'needs_review', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('broker', 'web', 'agent', 'user');--> statement-breakpoint
CREATE TABLE "broker_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"phone" text,
	"channel" text,
	"reputation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_signal_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"cost_usd" numeric,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"level" "location_level" NOT NULL,
	"parent_id" uuid,
	"geom" geometry(MultiPolygon, 4326),
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE "price_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid,
	"raw_signal_id" uuid NOT NULL,
	"broker_contact_id" uuid,
	"price_vnd" bigint,
	"area_m2" numeric,
	"price_per_m2" numeric,
	"price_basis" "price_basis" DEFAULT 'unknown' NOT NULL,
	"listing_type" "listing_type" DEFAULT 'unknown' NOT NULL,
	"deal_status" "deal_status" DEFAULT 'unknown' NOT NULL,
	"is_negotiable" boolean DEFAULT false NOT NULL,
	"source_type" "source_type" NOT NULL,
	"observed_at" timestamp with time zone,
	"confidence" numeric,
	"needs_review" boolean DEFAULT false NOT NULL,
	"extracted" jsonb,
	"extractor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_property_id" uuid,
	"name" text,
	"name_normalized" text,
	"type" "property_type" DEFAULT 'unknown' NOT NULL,
	"location_id" uuid,
	"geom" geometry(Point, 4326),
	"address_text" text,
	"year_built" integer,
	"renovation_year" integer,
	"attributes" jsonb,
	"embedding" vector(1536),
	"wiki_notes" text,
	"ai_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_merge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_id" uuid NOT NULL,
	"into_id" uuid NOT NULL,
	"reason" text,
	"actor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "raw_signal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_ref" text,
	"content_hash" text NOT NULL,
	"raw_text" text NOT NULL,
	"attachments" jsonb,
	"captured_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "signal_status" DEFAULT 'pending' NOT NULL,
	CONSTRAINT "raw_signal_dedup" UNIQUE("source_type","source_ref","content_hash")
);
--> statement-breakpoint
ALTER TABLE "extraction_job" ADD CONSTRAINT "extraction_job_raw_signal_id_raw_signal_id_fk" FOREIGN KEY ("raw_signal_id") REFERENCES "public"."raw_signal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_parent_id_location_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_raw_signal_id_raw_signal_id_fk" FOREIGN KEY ("raw_signal_id") REFERENCES "public"."raw_signal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_broker_contact_id_broker_contact_id_fk" FOREIGN KEY ("broker_contact_id") REFERENCES "public"."broker_contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_canonical_property_id_property_id_fk" FOREIGN KEY ("canonical_property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_merge" ADD CONSTRAINT "property_merge_from_id_property_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_merge" ADD CONSTRAINT "property_merge_into_id_property_id_fk" FOREIGN KEY ("into_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_geom_idx" ON "location" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "obs_property_time_idx" ON "price_observation" USING btree ("property_id","observed_at");--> statement-breakpoint
CREATE INDEX "obs_segment_time_idx" ON "price_observation" USING btree ("deal_status","listing_type","observed_at");--> statement-breakpoint
CREATE INDEX "property_geom_idx" ON "property" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "property_name_norm_idx" ON "property" USING btree ("name_normalized");
CREATE TYPE "public"."collection_kind" AS ENUM('stub', 'http');--> statement-breakpoint
CREATE TYPE "public"."collection_run_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TABLE "collection_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "collection_run_status" NOT NULL,
	"items_fetched" integer DEFAULT 0 NOT NULL,
	"signals_new" integer DEFAULT 0 NOT NULL,
	"signals_duplicate" integer DEFAULT 0 NOT NULL,
	"observations_created" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "collection_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"kind" "collection_kind" DEFAULT 'stub' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"last_run_at" timestamp with time zone,
	"last_status" "collection_run_status",
	"last_error" text,
	"last_item_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_run" ADD CONSTRAINT "collection_run_source_id_collection_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."collection_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_run_source_idx" ON "collection_run" USING btree ("source_id","started_at");
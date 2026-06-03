CREATE TABLE "collection_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"canonical_url" text NOT NULL,
	"http_status" integer,
	"content_hash" text,
	"text_hash" text,
	"etag" text,
	"last_modified" text,
	"fetch_duration_ms" integer,
	"bytes_fetched" integer DEFAULT 0 NOT NULL,
	"text_length" integer DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_fetched_at" timestamp with time zone,
	"last_raw_signal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_page_source_url" UNIQUE("source_id","canonical_url")
);
--> statement-breakpoint
ALTER TABLE "collection_run" ADD COLUMN "pages_fetched" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_run" ADD COLUMN "pages_skipped_unchanged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_run" ADD COLUMN "pages_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_run" ADD COLUMN "bytes_fetched" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_run" ADD COLUMN "items_extracted" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_page" ADD CONSTRAINT "collection_page_source_id_collection_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."collection_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_page" ADD CONSTRAINT "collection_page_last_raw_signal_id_raw_signal_id_fk" FOREIGN KEY ("last_raw_signal_id") REFERENCES "public"."raw_signal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_page_source_idx" ON "collection_page" USING btree ("source_id","last_fetched_at");
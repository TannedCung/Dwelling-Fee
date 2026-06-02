CREATE TABLE "geocode_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"lat" numeric,
	"lng" numeric,
	"display_name" text,
	"provider" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geocode_cache_query_unique" UNIQUE("query")
);

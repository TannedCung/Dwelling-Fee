CREATE TYPE "public"."ingest_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."ingest_session_status" AS ENUM('open', 'committed', 'abandoned');--> statement-breakpoint
CREATE TABLE "ingest_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "ingest_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "ingest_session_status" DEFAULT 'open' NOT NULL,
	"source_type" "source_type" DEFAULT 'broker' NOT NULL,
	"broker_contact_id" uuid,
	"title" text,
	"draft" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "price_observation" ADD COLUMN "ingest_session_id" uuid;--> statement-breakpoint
ALTER TABLE "raw_signal" ADD COLUMN "ingest_session_id" uuid;--> statement-breakpoint
ALTER TABLE "ingest_message" ADD CONSTRAINT "ingest_message_session_id_ingest_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ingest_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_session" ADD CONSTRAINT "ingest_session_broker_contact_id_broker_contact_id_fk" FOREIGN KEY ("broker_contact_id") REFERENCES "public"."broker_contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_message_session_idx" ON "ingest_message" USING btree ("session_id","created_at");--> statement-breakpoint
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_ingest_session_id_ingest_session_id_fk" FOREIGN KEY ("ingest_session_id") REFERENCES "public"."ingest_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_signal" ADD CONSTRAINT "raw_signal_ingest_session_id_ingest_session_id_fk" FOREIGN KEY ("ingest_session_id") REFERENCES "public"."ingest_session"("id") ON DELETE no action ON UPDATE no action;
CREATE TABLE "building" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_building_id" uuid,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"aliases" jsonb,
	"tags" jsonb,
	"location_id" uuid,
	"geom" geometry(Point, 4326),
	"address_text" text,
	"year_built" integer,
	"renovation_year" integer,
	"attributes" jsonb,
	"wiki_notes" text,
	"ai_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "building_project_name_unique" UNIQUE("project_id","name_normalized")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_project_id" uuid,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"aliases" jsonb,
	"tags" jsonb,
	"location_id" uuid,
	"geom" geometry(Point, 4326),
	"address_text" text,
	"year_built" integer,
	"renovation_year" integer,
	"attributes" jsonb,
	"wiki_notes" text,
	"ai_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_name_normalized_unique" UNIQUE("name_normalized")
);
--> statement-breakpoint
ALTER TABLE "collection_source" ALTER COLUMN "kind" SET DEFAULT 'http';--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "building_id" uuid;--> statement-breakpoint
ALTER TABLE "building" ADD CONSTRAINT "building_canonical_building_id_building_id_fk" FOREIGN KEY ("canonical_building_id") REFERENCES "public"."building"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building" ADD CONSTRAINT "building_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building" ADD CONSTRAINT "building_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_canonical_project_id_project_id_fk" FOREIGN KEY ("canonical_project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "building_project_idx" ON "building" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "building_geom_idx" ON "building" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "building_name_norm_idx" ON "building" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "building_aliases_idx" ON "building" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "building_tags_idx" ON "building" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "project_geom_idx" ON "project" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "project_name_norm_idx" ON "project" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "project_aliases_idx" ON "project" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "project_tags_idx" ON "project" USING gin ("tags");--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_building_id_building_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."building"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "property_project_idx" ON "property" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "property_building_idx" ON "property" USING btree ("building_id");--> statement-breakpoint
INSERT INTO "project" ("name", "name_normalized", "aliases", "tags", "location_id", "geom", "address_text", "created_at", "updated_at")
SELECT DISTINCT ON (norm)
	project_name,
	norm,
	aliases,
	tags,
	location_id,
	geom,
	address_text,
	now(),
	now()
FROM (
	SELECT
		project_name,
		coalesce(nullif(project_name_normalized, ''), lower(trim(project_name))) AS norm,
		aliases,
		tags,
		location_id,
		geom,
		address_text
	FROM "property"
	WHERE project_name IS NOT NULL AND trim(project_name) <> ''
) p
WHERE norm IS NOT NULL AND norm <> ''
ORDER BY norm, project_name
ON CONFLICT ("name_normalized") DO NOTHING;--> statement-breakpoint
INSERT INTO "building" ("project_id", "name", "name_normalized", "aliases", "tags", "location_id", "geom", "address_text", "created_at", "updated_at")
SELECT DISTINCT ON (pr.id, b.norm)
	pr.id,
	b.building_name,
	b.norm,
	b.aliases,
	b.tags,
	b.location_id,
	b.geom,
	b.address_text,
	now(),
	now()
FROM (
	SELECT
		project_name,
		coalesce(nullif(project_name_normalized, ''), lower(trim(project_name))) AS project_norm,
		building_name,
		coalesce(nullif(building_name_normalized, ''), lower(trim(building_name))) AS norm,
		aliases,
		tags,
		location_id,
		geom,
		address_text
	FROM "property"
	WHERE project_name IS NOT NULL AND trim(project_name) <> ''
		AND building_name IS NOT NULL AND trim(building_name) <> ''
) b
INNER JOIN "project" pr ON pr.name_normalized = b.project_norm
WHERE b.norm IS NOT NULL AND b.norm <> ''
ORDER BY pr.id, b.norm, b.building_name
ON CONFLICT ("project_id", "name_normalized") DO NOTHING;--> statement-breakpoint
UPDATE "property" p
SET "project_id" = pr.id
FROM "project" pr
WHERE p.project_id IS NULL
	AND p.project_name IS NOT NULL
	AND pr.name_normalized = coalesce(nullif(p.project_name_normalized, ''), lower(trim(p.project_name)));--> statement-breakpoint
UPDATE "property" p
SET "building_id" = b.id
FROM "building" b
WHERE p.building_id IS NULL
	AND p.project_id = b.project_id
	AND p.building_name IS NOT NULL
	AND b.name_normalized = coalesce(nullif(p.building_name_normalized, ''), lower(trim(p.building_name)));

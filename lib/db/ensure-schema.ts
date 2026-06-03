import { sql } from "drizzle-orm";
import { getDb, type DbExecutor } from "../../db/client";

const STATEMENTS = [
  sql`ALTER TABLE "ingest_message" ADD COLUMN IF NOT EXISTS "attachments" jsonb`,
  sql`ALTER TABLE "price_observation" ADD COLUMN IF NOT EXISTS "tags" jsonb`,
  sql`ALTER TABLE "property" ADD COLUMN IF NOT EXISTS "project_name" text`,
  sql`ALTER TABLE "property" ADD COLUMN IF NOT EXISTS "project_name_normalized" text`,
  sql`ALTER TABLE "property" ADD COLUMN IF NOT EXISTS "building_name" text`,
  sql`ALTER TABLE "property" ADD COLUMN IF NOT EXISTS "building_name_normalized" text`,
  sql`ALTER TABLE "property" ADD COLUMN IF NOT EXISTS "house_number" text`,
  sql`ALTER TABLE "property" ADD COLUMN IF NOT EXISTS "house_number_normalized" text`,
  sql`ALTER TABLE "property" ADD COLUMN IF NOT EXISTS "aliases" jsonb`,
  sql`ALTER TABLE "property" ADD COLUMN IF NOT EXISTS "tags" jsonb`,
  sql`CREATE INDEX IF NOT EXISTS "obs_tags_idx" ON "price_observation" USING gin ("tags")`,
  sql`CREATE INDEX IF NOT EXISTS "property_project_name_norm_idx" ON "property" USING btree ("project_name_normalized")`,
  sql`CREATE INDEX IF NOT EXISTS "property_building_name_norm_idx" ON "property" USING btree ("building_name_normalized")`,
  sql`CREATE INDEX IF NOT EXISTS "property_house_number_norm_idx" ON "property" USING btree ("house_number_normalized")`,
  sql`CREATE INDEX IF NOT EXISTS "property_tags_idx" ON "property" USING gin ("tags")`,
];

const REQUIRED_COLUMNS = [
  ["ingest_message", "attachments"],
  ["price_observation", "tags"],
  ["property", "project_name"],
  ["property", "project_name_normalized"],
  ["property", "building_name"],
  ["property", "building_name_normalized"],
  ["property", "house_number"],
  ["property", "house_number_normalized"],
  ["property", "aliases"],
  ["property", "tags"],
] as const;

export async function ensurePropertyHierarchySchema(db: DbExecutor = getDb()): Promise<{ applied: number; missing: string[] }> {
  for (const statement of STATEMENTS) await db.execute(statement);

  const missing: string[] = [];
  for (const [table, column] of REQUIRED_COLUMNS) {
    const rows = await db.execute(sql`
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = ${table}
        and column_name = ${column}
      limit 1
    `);
    const found = Array.isArray(rows) ? rows.length > 0 : (rows as { rows?: unknown[] }).rows?.length;
    if (!found) missing.push(`${table}.${column}`);
  }

  return { applied: STATEMENTS.length, missing };
}

const COLLECTION_STATEMENTS = [
  sql`ALTER TABLE "collection_run" ADD COLUMN IF NOT EXISTS "pages_fetched" integer DEFAULT 0 NOT NULL`,
  sql`ALTER TABLE "collection_run" ADD COLUMN IF NOT EXISTS "pages_skipped_unchanged" integer DEFAULT 0 NOT NULL`,
  sql`ALTER TABLE "collection_run" ADD COLUMN IF NOT EXISTS "pages_failed" integer DEFAULT 0 NOT NULL`,
  sql`ALTER TABLE "collection_run" ADD COLUMN IF NOT EXISTS "bytes_fetched" integer DEFAULT 0 NOT NULL`,
  sql`ALTER TABLE "collection_run" ADD COLUMN IF NOT EXISTS "items_extracted" integer DEFAULT 0 NOT NULL`,
  sql`
    CREATE TABLE IF NOT EXISTS "collection_page" (
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
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "collection_page_source_url" ON "collection_page" USING btree ("source_id","canonical_url")`,
  sql`CREATE INDEX IF NOT EXISTS "collection_page_source_idx" ON "collection_page" USING btree ("source_id","last_fetched_at")`,
];

const COLLECTION_REQUIRED_COLUMNS = [
  ["collection_run", "pages_fetched"],
  ["collection_run", "pages_skipped_unchanged"],
  ["collection_run", "pages_failed"],
  ["collection_run", "bytes_fetched"],
  ["collection_run", "items_extracted"],
  ["collection_page", "canonical_url"],
  ["collection_page", "text_hash"],
  ["collection_page", "last_raw_signal_id"],
] as const;

let collectionSchemaPromise: Promise<{ applied: number; missing: string[] }> | null = null;

export function ensureCollectionSchema(db: DbExecutor = getDb()): Promise<{ applied: number; missing: string[] }> {
  collectionSchemaPromise ??= ensureCollectionSchemaOnce(db).catch((error) => {
    collectionSchemaPromise = null;
    throw error;
  });
  return collectionSchemaPromise;
}

async function ensureCollectionSchemaOnce(db: DbExecutor): Promise<{ applied: number; missing: string[] }> {
  for (const statement of COLLECTION_STATEMENTS) await db.execute(statement);

  const missing: string[] = [];
  for (const [table, column] of COLLECTION_REQUIRED_COLUMNS) {
    const rows = await db.execute(sql`
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = ${table}
        and column_name = ${column}
      limit 1
    `);
    const found = Array.isArray(rows) ? rows.length > 0 : (rows as { rows?: unknown[] }).rows?.length;
    if (!found) missing.push(`${table}.${column}`);
  }

  return { applied: COLLECTION_STATEMENTS.length, missing };
}

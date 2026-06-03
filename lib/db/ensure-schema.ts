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

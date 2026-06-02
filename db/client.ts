import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

/**
 * Drizzle client over Neon's HTTP driver — suited to short reads/writes in
 * Vercel functions and route handlers (design §8). Long-running batch jobs and
 * migrations should use a pooled connection instead.
 *
 * Lazy singleton so importing this module never throws at build time when
 * DATABASE_URL is absent; it only connects on first query.
 */
let _db: NeonHttpDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  _db = drizzle(neon(url), { schema });
  return _db;
}

export { schema };

import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { neon, Pool, neonConfig } from "@neondatabase/serverless";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Two Drizzle clients over Neon (design §8):
 *
 *  - getDb()   — the HTTP driver: lowest-latency for short, single-statement reads
 *                in route handlers / server components. Cannot do multi-statement
 *                transactions.
 *  - transaction() — the pooled (WebSocket) driver, which DOES support interactive
 *                transactions. Use it for any flow that issues several dependent
 *                writes so partial failure can't leave inconsistent state.
 *
 * Both are lazy singletons so importing this module never throws at build time
 * when DATABASE_URL is absent; they only connect on first query.
 */

// The pooled driver speaks WebSocket. Node 22+ ships a global WebSocket, so we
// reuse it rather than depending on the `ws` package.
if (!neonConfig.webSocketConstructor && typeof WebSocket !== "undefined") {
  neonConfig.webSocketConstructor = WebSocket as never;
}

let _db: NeonHttpDatabase<typeof schema> | null = null;
let _pool: NeonDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  _db = drizzle(neon(url), { schema });
  return _db;
}

/** Pooled client — required for interactive transactions (see transaction()). */
export function getPoolDb(): NeonDatabase<typeof schema> {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  _pool = drizzlePool(new Pool({ connectionString: url }), { schema });
  return _pool;
}

/**
 * Any Drizzle executor — the base client OR a transaction handle. Functions that
 * need to run either standalone or inside a caller's transaction take this type
 * and default to getDb().
 */
export type DbExecutor = PgDatabase<any, typeof schema, ExtractTablesWithRelations<typeof schema>>;

/** Run `fn` inside a single atomic transaction on the pooled driver. */
export function transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  return getPoolDb().transaction((tx) => fn(tx));
}

export { schema };

import { sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { geocode } from "./geocode";

// Normalize drizzle/neon-http execute() return shape across versions.
function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const r = (res as { rows?: T[] }).rows;
  return r ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pendingGeocodeCount(): Promise<number> {
  const db = getDb();
  const res = await db.execute(
    sql`select count(*)::int as n from property where geom is null and (address_text is not null or name is not null)`,
  );
  return Number(rowsOf<{ n: number }>(res)[0]?.n ?? 0);
}

export interface BackfillResult {
  geocoded: number;
  failed: number;
  remaining: number;
}

/**
 * Geocode properties that have an address/name but no point yet. Sequential with
 * a delay to respect the provider's rate limit; cached lookups make repeat runs cheap.
 * Bounded per call so it stays within a serverless function's time budget — the UI
 * can click again until `remaining` is 0.
 */
export async function geocodeMissing(limit = 5): Promise<BackfillResult> {
  const db = getDb();
  const res = await db.execute(
    sql`select id, name, address_text from property
        where geom is null and (address_text is not null or name is not null)
        order by created_at limit ${limit}`,
  );
  const rows = rowsOf<{ id: string; name: string | null; address_text: string | null }>(res);

  let geocoded = 0, failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const query = [row.name, row.address_text].filter(Boolean).join(", ") + ", Vietnam";
    const pt = await geocode(query);
    if (pt) {
      await db.execute(
        sql`update property set geom = ST_SetSRID(ST_MakePoint(${pt.lng}, ${pt.lat}), 4326), updated_at = now() where id = ${row.id}`,
      );
      geocoded++;
    } else {
      failed++;
    }
    if (i < rows.length - 1) await sleep(1100); // Nominatim: ≤ 1 req/s
  }

  return { geocoded, failed, remaining: await pendingGeocodeCount() };
}

export interface MapPoint {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  medianPpm2: number | null;
  n: number;
}

/** Geocoded properties with their median sale price/m² for the map + heatmap. */
export async function mapPoints(): Promise<MapPoint[]> {
  const db = getDb();
  const res = await db.execute(sql`
    select p.id, p.name, ST_Y(p.geom) as lat, ST_X(p.geom) as lng,
      percentile_cont(0.5) within group (order by o.price_per_m2)
        filter (where o.listing_type = 'sale' and o.price_per_m2 is not null and not o.needs_review) as median_ppm2,
      count(o.id) filter (where o.price_per_m2 is not null and not o.needs_review) as n
    from property p
    left join price_observation o on o.property_id = p.id
    where p.geom is not null
    group by p.id`);
  return rowsOf<{ id: string; name: string | null; lat: number; lng: number; median_ppm2: string | null; n: number }>(res).map((r) => ({
    id: r.id,
    name: r.name,
    lat: Number(r.lat),
    lng: Number(r.lng),
    medianPpm2: r.median_ppm2 != null ? Number(r.median_ppm2) : null,
    n: Number(r.n),
  }));
}

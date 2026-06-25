import { sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { ensurePropertyHierarchySchema } from "../db/ensure-schema";
import { geocode } from "./geocode";

// Normalize drizzle/neon-http execute() return shape across versions.
function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const r = (res as { rows?: T[] }).rows;
  return r ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_QUERIES_PER_PROPERTY = 8;

/** Expand common Vietnamese address shorthand so the geocoder can resolve districts. */
function expandVn(s: string): string {
  return s
    .replace(/[\/|]+/g, " ")
    .replace(/\b(?:Q\.?\s?9|Quận\s*9|District\s*9)\b/gi, "Thành phố Thủ Đức, Thành phố Hồ Chí Minh")
    .replace(/\bQ\.?\s?(\d{1,2})\b/gi, "Quận $1") // Q7 → Quận 7
    .replace(/\bDistrict\s*(\d{1,2})\b/gi, "Quận $1")
    .replace(/\bP\.?\s?(\d{1,2})\b/g, "Phường $1") // P.3 → Phường 3
    .replace(/\s+/g, " ")
    .trim();
}

/** Build a geocoder query from a property's name + address, deduped and expanded. */
export function buildGeocodeQuery(name: string | null, addressText: string | null): string {
  const parts = [name, addressText]
    .filter((s): s is string => Boolean(s))
    .map((s) => expandVn(s.trim()));
  const unique = [...new Set(parts)];
  return unique.join(", ") + ", Vietnam";
}

export interface GeocodeCandidateInput {
  name: string | null;
  projectName: string | null;
  buildingName: string | null;
  houseNumber: string | null;
  addressText: string | null;
  projectAddressText: string | null;
  buildingAddressText: string | null;
  observationLocationTexts: string[];
}

export interface GeocodeCandidate {
  query: string;
  addressText: string | null;
}

export function buildGeocodeCandidates(input: GeocodeCandidateInput): GeocodeCandidate[] {
  const projectName = stripGeocodeNamePrefix(input.projectName);
  const buildingName = input.buildingName?.trim() || null;
  const specificName = [projectName, buildingName, input.houseNumber].filter(Boolean).join(" ") || input.name;
  const reversedName = [buildingName, projectName].filter(Boolean).join(" ") || null;
  const entityAddressTexts = uniqueText([
    input.addressText,
    input.buildingAddressText,
    input.projectAddressText,
  ]);
  const observationAddressTexts = uniqueText(input.observationLocationTexts)
    .sort((a, b) => b.length - a.length);
  const addressTexts = uniqueText([...entityAddressTexts, ...observationAddressTexts]);

  const candidates: GeocodeCandidate[] = [];
  const push = (name: string | null, addressText: string | null) => {
    const query = buildGeocodeQuery(stripGeocodeNamePrefix(name), addressText);
    if (query !== "Vietnam") candidates.push({ query, addressText });
  };
  const primaryAddress = addressTexts[0] ?? null;

  push(specificName, primaryAddress);
  push(reversedName, primaryAddress);
  push(projectName, primaryAddress);
  push(reversedName, null);
  push(specificName, null);
  push(projectName, null);
  for (const address of addressTexts) push(specificName, address);
  for (const address of addressTexts) push(reversedName, address);
  for (const address of addressTexts) push(projectName, address);
  for (const address of addressTexts) push(null, address);

  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      if (seen.has(candidate.query)) return false;
      seen.add(candidate.query);
      return true;
    })
    .slice(0, MAX_QUERIES_PER_PROPERTY);
}

export async function pendingGeocodeCount(): Promise<number> {
  const db = getDb();
  await ensurePropertyHierarchySchema(db);
  const res = await db.execute(
    sql`select count(*)::int as n
        from property p
        left join project pr on p.project_id = pr.id
        left join building b on p.building_id = b.id
        where p.geom is null
          and (
            p.address_text is not null
            or p.name is not null
            or p.house_number is not null
            or pr.name is not null
            or b.name is not null
          )`,
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
  await ensurePropertyHierarchySchema(db);
  const res = await db.execute(
    sql`select p.id,
          coalesce(nullif(concat_ws(' ', pr.name, b.name, p.house_number), ''), p.name) as name,
          pr.name as project_name,
          b.name as building_name,
          p.house_number,
          p.address_text,
          pr.address_text as project_address_text,
          b.address_text as building_address_text,
          array_remove(array_agg(distinct o.extracted->>'locationText'), null) as observation_location_texts
        from property p
        left join project pr on p.project_id = pr.id
        left join building b on p.building_id = b.id
        left join price_observation o on o.property_id = p.id
        where p.geom is null
          and (
            p.address_text is not null
            or p.name is not null
            or p.house_number is not null
            or pr.name is not null
            or b.name is not null
          )
        group by p.id, pr.id, b.id
        order by p.created_at limit ${limit}`,
  );
  const rows = rowsOf<{
    id: string;
    name: string | null;
    project_name: string | null;
    building_name: string | null;
    house_number: string | null;
    address_text: string | null;
    project_address_text: string | null;
    building_address_text: string | null;
    observation_location_texts: string[] | null;
  }>(res);

  let geocoded = 0, failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const candidates = buildGeocodeCandidates({
      name: row.name,
      projectName: row.project_name,
      buildingName: row.building_name,
      houseNumber: row.house_number,
      addressText: row.address_text,
      projectAddressText: row.project_address_text,
      buildingAddressText: row.building_address_text,
      observationLocationTexts: row.observation_location_texts ?? [],
    });
    const fallbackAddressText = candidates.find((candidate) => candidate.addressText)?.addressText ?? null;
    const match = await firstGeocodeMatch(candidates);
    if (match) {
      await db.execute(
        sql`update property
            set geom = ST_SetSRID(ST_MakePoint(${match.point.lng}, ${match.point.lat}), 4326),
                address_text = coalesce(address_text, ${match.candidate.addressText}, ${fallbackAddressText}),
                updated_at = now()
            where id = ${row.id}`,
      );
      geocoded++;
    } else {
      failed++;
    }
    if (i < rows.length - 1) await sleep(1100); // Nominatim: ≤ 1 req/s
  }

  return { geocoded, failed, remaining: await pendingGeocodeCount() };
}

async function firstGeocodeMatch(candidates: GeocodeCandidate[]) {
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const point = await geocode(candidate.query);
    if (point) return { candidate, point };
    if (i < candidates.length - 1) await sleep(1100);
  }
  return null;
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
  await ensurePropertyHierarchySchema(db);
  const res = await db.execute(sql`
    select p.id,
      coalesce(nullif(concat_ws(' / ', pr.name, b.name, p.house_number), ''), p.name) as name,
      ST_Y(p.geom) as lat, ST_X(p.geom) as lng,
      percentile_cont(0.5) within group (order by o.price_per_m2)
        filter (where o.listing_type = 'sale' and o.price_per_m2 is not null and not o.needs_review) as median_ppm2,
      count(o.id) filter (where o.price_per_m2 is not null and not o.needs_review) as n
    from property p
    left join project pr on p.project_id = pr.id
    left join building b on p.building_id = b.id
    left join price_observation o on o.property_id = p.id
    where p.geom is not null
    group by p.id, pr.id, b.id`);
  return rowsOf<{ id: string; name: string | null; lat: number; lng: number; median_ppm2: string | null; n: number }>(res).map((r) => ({
    id: r.id,
    name: r.name,
    lat: Number(r.lat),
    lng: Number(r.lng),
    medianPpm2: r.median_ppm2 != null ? Number(r.median_ppm2) : null,
    n: Number(r.n),
  }));
}

function stripGeocodeNamePrefix(value: string | null | undefined): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  const stripped = clean
    .replace(/^(?:khu\s+(?:đô|do)\s+thị|dự\s+án|du\s+an|chung\s+cư|chung\s+cu|căn\s+hộ|can\s+ho)\s+/i, "")
    .replace(/\s+(?:khu\s+(?:đô|do)\s+thị|dự\s+án|du\s+an|chung\s+cư|chung\s+cu|căn\s+hộ|can\s+ho)\s+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || clean;
}

function uniqueText(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value?.trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

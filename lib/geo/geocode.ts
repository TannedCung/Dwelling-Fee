import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { geocodeCache } from "../../db/schema";

/**
 * Geocoding (design §4 step "geocode"). Default provider is Nominatim/OSM — free,
 * no key, but rate-limited and weaker on terse Vietnamese addresses. Swap in a
 * stronger provider (Google/Mapbox) by changing this module; results are cached
 * (including negative results) so we never re-hit the provider for the same query.
 */
const PROVIDER_URL = process.env.GEOCODER_URL ?? "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "DwellingFee/0.1 (housing price intelligence; private tool)";

export interface GeoPoint {
  lat: number;
  lng: number;
  displayName: string | null;
}

export async function geocode(rawQuery: string): Promise<GeoPoint | null> {
  const query = rawQuery.trim();
  if (!query) return null;
  const db = getDb();

  const cached = await db.query.geocodeCache.findFirst({ where: eq(geocodeCache.query, query) });
  if (cached) {
    return cached.lat != null && cached.lng != null
      ? { lat: Number(cached.lat), lng: Number(cached.lng), displayName: cached.displayName }
      : null; // cached negative result
  }

  let result: GeoPoint | null = null;
  try {
    const url = `${PROVIDER_URL}?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&countrycodes=vn`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "vi,en" } });
    if (res.ok) {
      const arr = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
      if (Array.isArray(arr) && arr[0]) {
        result = { lat: Number(arr[0].lat), lng: Number(arr[0].lon), displayName: arr[0].display_name ?? null };
      }
    }
  } catch {
    // network error → treat as not found; caching below avoids hammering on retry
  }

  await db
    .insert(geocodeCache)
    .values({
      query,
      lat: result ? String(result.lat) : null,
      lng: result ? String(result.lng) : null,
      displayName: result?.displayName ?? null,
      provider: "nominatim",
    })
    .onConflictDoNothing({ target: geocodeCache.query });

  return result;
}

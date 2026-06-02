import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { priceObservation } from "../db/schema";
import { distribution, MIN_SAMPLE, type Distribution } from "./stats";

/**
 * Segmented price/m² distributions (design §7). We NEVER mix listing_type or
 * deal_status into one statistic — asking ≠ transacted, sale ≠ rent. Each segment
 * is reported separately with its sample size; small segments are flagged.
 */

export interface Segment {
  listingType: string;
  dealStatus: string;
  propertyType: string;
  dist: Distribution;
  /** true when n < MIN_SAMPLE — statistic is not trustworthy (§7). */
  underpowered: boolean;
}

export async function segmentStats(): Promise<Segment[]> {
  const db = getDb();
  // Only resolved (linked) observations that aren't pending review feed analytics.
  const rows = await db
    .select({
      listingType: priceObservation.listingType,
      dealStatus: priceObservation.dealStatus,
      pricePerM2: priceObservation.pricePerM2,
    })
    .from(priceObservation)
    .where(eq(priceObservation.needsReview, false));

  // Bucket by (listingType, dealStatus). Property type lives on `property`; we keep
  // segments coarse here and refine to property_type once geocoding/joins land.
  const buckets = new Map<string, { key: { l: string; d: string }; vals: number[] }>();
  for (const r of rows) {
    if (r.pricePerM2 == null) continue;
    const k = `${r.listingType}|${r.dealStatus}`;
    if (!buckets.has(k)) buckets.set(k, { key: { l: r.listingType, d: r.dealStatus }, vals: [] });
    buckets.get(k)!.vals.push(Number(r.pricePerM2));
  }

  return [...buckets.values()]
    .map(({ key, vals }) => {
      const dist = distribution(vals);
      return {
        listingType: key.l,
        dealStatus: key.d,
        propertyType: "all",
        dist,
        underpowered: dist.n < MIN_SAMPLE,
      };
    })
    .sort((a, b) => b.dist.n - a.dist.n);
}

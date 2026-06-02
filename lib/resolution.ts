import { and, isNull, or, ilike } from "drizzle-orm";
import { getDb, type DbExecutor } from "../db/client";
import { property } from "../db/schema";
import type { PropertyExtraction } from "./extraction/schema";
import { normalizeName, tokens, jaccard } from "./text";

/**
 * Deterministic entity resolution (design §5). Phase 1 uses blocking + weighted
 * scoring + decision bands — embeddings come in Phase 3 once there's labeled data
 * to tune against. Merges (and unmerges) are handled separately via property_merge.
 */

// Decision thresholds on the combined score (0..1).
const AUTO_LINK = 0.8; // confident same property → link automatically
const REVIEW_MIN = 0.45; // plausible but uncertain → human review queue

export interface Candidate {
  id: string;
  name: string | null;
  type: string;
  addressText: string | null;
  score: number;
}

export type Resolution =
  | { action: "link"; propertyId: string; candidates: Candidate[] }
  | { action: "review"; candidates: Candidate[] }
  | { action: "create"; candidates: Candidate[] };

/** Combined match score: name similarity dominates, type + area band refine it. */
export function score(extraction: PropertyExtraction, cand: { name: string | null; type: string; attributes: unknown }): number {
  const exTokens = tokens(normalizeName(extraction.name ?? ""));
  const candTokens = tokens(normalizeName(cand.name ?? ""));
  const nameSim = jaccard(exTokens, candTokens);

  const typeMatch = extraction.type !== "unknown" && extraction.type === cand.type ? 1 : 0;

  let areaMatch = 0;
  const candArea = (cand.attributes as { areaM2?: number } | null)?.areaM2;
  if (extraction.areaM2 != null && candArea != null && candArea > 0) {
    areaMatch = Math.abs(extraction.areaM2 - candArea) / candArea <= 0.1 ? 1 : 0;
  }

  return 0.6 * nameSim + 0.25 * typeMatch + 0.15 * areaMatch;
}

/** Find candidate canonical properties for an extraction, ranked by score. */
export async function findCandidates(extraction: PropertyExtraction, db: DbExecutor = getDb()): Promise<Candidate[]> {
  const blockingTokens = tokens(normalizeName(extraction.name ?? extraction.locationText ?? ""));
  if (blockingTokens.length === 0) return [];

  // Block on shared tokens (substring of the normalized name) to avoid scanning everything.
  const rows = await db
    .select({
      id: property.id,
      name: property.name,
      type: property.type,
      addressText: property.addressText,
      attributes: property.attributes,
    })
    .from(property)
    .where(
      and(
        isNull(property.canonicalPropertyId), // only canonical records
        or(...blockingTokens.map((t) => ilike(property.nameNormalized, `%${t}%`))),
      ),
    )
    .limit(50);

  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      addressText: r.addressText,
      score: score(extraction, r),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

/** Decide how to attach an extraction: auto-link, queue for review, or create new. */
export async function resolve(extraction: PropertyExtraction, db: DbExecutor = getDb()): Promise<Resolution> {
  const candidates = await findCandidates(extraction, db);
  const best = candidates[0];
  if (best && best.score >= AUTO_LINK) return { action: "link", propertyId: best.id, candidates };
  if (best && best.score >= REVIEW_MIN) return { action: "review", candidates };
  return { action: "create", candidates };
}

/** Create a canonical property from an extraction. Returns the new id. */
export async function createPropertyFromExtraction(extraction: PropertyExtraction, db: DbExecutor = getDb()): Promise<string> {
  const name = extraction.name?.trim() || null;
  const [row] = await db
    .insert(property)
    .values({
      name,
      nameNormalized: name ? normalizeName(name) : null,
      type: extraction.type,
      addressText: extraction.locationText ?? null,
      attributes: extraction.areaM2 != null || extraction.bedrooms != null
        ? { areaM2: extraction.areaM2, bedrooms: extraction.bedrooms }
        : null,
    })
    .returning({ id: property.id });
  return row!.id;
}

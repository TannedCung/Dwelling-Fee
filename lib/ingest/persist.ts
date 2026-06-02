import { getDb } from "../../db/client";
import { priceObservation } from "../../db/schema";
import { resolve, createPropertyFromExtraction } from "../resolution";
import type { PropertyExtraction } from "../extraction/schema";
import { EXTRACTOR_VERSION } from "../extraction/extract";

// Observations below this extractor confidence are quarantined for human review
// and excluded from analytics until confirmed (design §2, §7).
export const REVIEW_CONFIDENCE_THRESHOLD = 0.6;

export interface PersistContext {
  rawSignalId: string;
  ingestSessionId?: string | null;
  sourceType: "broker" | "web" | "agent" | "user";
}

export interface PersistResult {
  observationsCreated: number;
  autoLinked: number;
  created: number;
  needsReview: number;
}

/**
 * Run entity resolution over a draft and write the resulting price observations,
 * carrying provenance (raw signal + ingest session). Shared by both the
 * conversational commit (lib/ingest/commit) and the one-shot ingest (lib/ingest).
 *
 * Each property is auto-linked to an existing property, used to create a new one,
 * or — if low-confidence or an ambiguous match — quarantined to the review queue.
 */
export async function persistDraft(properties: PropertyExtraction[], ctx: PersistContext): Promise<PersistResult> {
  const db = getDb();
  let autoLinked = 0, created = 0, needsReview = 0;
  const rows = [];

  for (const p of properties) {
    let propertyId: string | null = null;
    let review = p.confidence < REVIEW_CONFIDENCE_THRESHOLD;

    if (!review) {
      const decision = await resolve(p);
      if (decision.action === "link") { propertyId = decision.propertyId; autoLinked++; }
      else if (decision.action === "create") { propertyId = await createPropertyFromExtraction(p); created++; }
      else review = true; // ambiguous match → queue for human resolution
    }
    if (review) needsReview++;

    rows.push({
      propertyId,
      rawSignalId: ctx.rawSignalId,
      ingestSessionId: ctx.ingestSessionId ?? null,
      priceVnd: p.priceVnd,
      areaM2: p.areaM2 != null ? String(p.areaM2) : null,
      pricePerM2: derivePricePerM2(p.priceVnd, p.areaM2, p.priceBasis),
      priceBasis: p.priceBasis,
      listingType: p.listingType,
      dealStatus: p.dealStatus,
      isNegotiable: p.isNegotiable,
      sourceType: ctx.sourceType,
      confidence: String(p.confidence),
      needsReview: review,
      extracted: p,
      extractor: EXTRACTOR_VERSION,
    });
  }

  if (rows.length > 0) await db.insert(priceObservation).values(rows);
  return { observationsCreated: properties.length, autoLinked, created, needsReview };
}

export function derivePricePerM2(
  priceVnd: number | null,
  areaM2: number | null,
  basis: PropertyExtraction["priceBasis"],
): string | null {
  if (priceVnd == null) return null;
  if (basis === "per_m2") return String(priceVnd);
  if (basis === "total" && areaM2 && areaM2 > 0) return String(Math.round(priceVnd / areaM2));
  return null;
}

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { rawSignal, priceObservation } from "../db/schema";
import { extract, EXTRACTOR_VERSION } from "./extraction/extract";
import { resolve, createPropertyFromExtraction } from "./resolution";
import type { PropertyExtraction } from "./extraction/schema";

// Observations below this extractor confidence are quarantined for human review
// and excluded from analytics until confirmed (design §2, §7).
const REVIEW_CONFIDENCE_THRESHOLD = 0.6;

export interface IngestResult {
  rawSignalId: string;
  duplicate: boolean;
  observationsCreated: number;
  autoLinked: number;
  created: number;
  needsReview: number;
}

/**
 * Phase 1 ingest flow (design §4): store the raw signal immutably, extract
 * structured observations, then run entity resolution per property —
 * auto-link to an existing property, create a new one, or quarantine for review.
 *
 * Idempotent on content hash: re-submitting identical text returns the existing
 * signal without re-extracting (cost control, design §8).
 */
export async function ingestSignal(input: {
  rawText: string;
  sourceType?: "broker" | "web" | "agent" | "user";
  sourceRef?: string | null;
}): Promise<IngestResult> {
  const db = getDb();
  const source = input.sourceType ?? "broker";
  const contentHash = createHash("sha256").update(input.rawText.trim()).digest("hex");

  const inserted = await db
    .insert(rawSignal)
    .values({ sourceType: source, sourceRef: input.sourceRef ?? null, contentHash, rawText: input.rawText })
    .onConflictDoNothing({ target: [rawSignal.sourceType, rawSignal.sourceRef, rawSignal.contentHash] })
    .returning({ id: rawSignal.id });

  if (inserted.length === 0) {
    const existing = await db.query.rawSignal.findFirst({
      columns: { id: true },
      where: (s, { and, eq, isNull }) =>
        and(
          eq(s.sourceType, source),
          input.sourceRef == null ? isNull(s.sourceRef) : eq(s.sourceRef, input.sourceRef),
          eq(s.contentHash, contentHash),
        ),
    });
    return { rawSignalId: existing!.id, duplicate: true, observationsCreated: 0, autoLinked: 0, created: 0, needsReview: 0 };
  }

  const signalId = inserted[0]!.id;
  const { properties } = await extract(input.rawText);

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
      rawSignalId: signalId,
      priceVnd: p.priceVnd,
      areaM2: p.areaM2 != null ? String(p.areaM2) : null,
      pricePerM2: derivePricePerM2(p.priceVnd, p.areaM2, p.priceBasis),
      priceBasis: p.priceBasis,
      listingType: p.listingType,
      dealStatus: p.dealStatus,
      isNegotiable: p.isNegotiable,
      sourceType: source,
      confidence: String(p.confidence),
      needsReview: review,
      extracted: p,
      extractor: EXTRACTOR_VERSION,
    });
  }

  if (rows.length > 0) await db.insert(priceObservation).values(rows);

  await db
    .update(rawSignal)
    .set({ status: needsReview > 0 ? "needs_review" : "extracted" })
    .where(eq(rawSignal.id, signalId));

  return { rawSignalId: signalId, duplicate: false, observationsCreated: properties.length, autoLinked, created, needsReview };
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

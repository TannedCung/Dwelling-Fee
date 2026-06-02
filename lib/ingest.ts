import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { rawSignal, priceObservation } from "../db/schema";
import { extract, EXTRACTOR_VERSION } from "./extraction/extract";

// Observations below this extractor confidence are quarantined for human review
// and excluded from analytics until confirmed (design §2, §7).
const REVIEW_CONFIDENCE_THRESHOLD = 0.6;

export interface IngestResult {
  rawSignalId: string;
  duplicate: boolean;
  observationsCreated: number;
  needsReview: number;
}

/**
 * Phase 1 ingest flow (design §4 step 2): store the raw signal immutably, extract
 * structured observations, and persist them unresolved (property_id stays null
 * until entity resolution runs — that's Phase 1's review step / Phase 3 agent).
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

  // Idempotency: skip if this exact text from this source was already ingested.
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
    return { rawSignalId: existing!.id, duplicate: true, observationsCreated: 0, needsReview: 0 };
  }

  const signalId = inserted[0]!.id;

  const { properties } = await extract(input.rawText);

  let needsReview = 0;
  if (properties.length > 0) {
    const rows = properties.map((p) => {
      const review = p.confidence < REVIEW_CONFIDENCE_THRESHOLD;
      if (review) needsReview++;
      return {
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
      };
    });
    await db.insert(priceObservation).values(rows);
  }

  await db
    .update(rawSignal)
    .set({ status: needsReview > 0 ? "needs_review" : "extracted" })
    .where(eq(rawSignal.id, signalId));

  return { rawSignalId: signalId, duplicate: false, observationsCreated: properties.length, needsReview };
}

function derivePricePerM2(
  priceVnd: number | null,
  areaM2: number | null,
  basis: "total" | "per_m2" | "unknown",
): string | null {
  if (priceVnd == null) return null;
  if (basis === "per_m2") return String(priceVnd);
  if (basis === "total" && areaM2 && areaM2 > 0) return String(Math.round(priceVnd / areaM2));
  return null;
}

import { and, count, desc, eq } from "drizzle-orm";
import { getDb, transaction, type DbExecutor } from "../db/client";
import { priceObservation, rawSignal } from "../db/schema";
import { PropertyExtraction } from "./extraction/schema";
import { findCandidates, createPropertyFromExtraction, type Candidate } from "./resolution";

/**
 * Human-in-the-loop review (design §2, §5): observations flagged needs_review are
 * surfaced with candidate property matches so a person can link, create, or dismiss.
 */

export interface ReviewItem {
  observationId: string;
  rawSignalId: string;
  rawText: string;
  extraction: PropertyExtraction;
  priceVnd: number | null;
  confidence: number | null;
  candidates: Candidate[];
}

/** Cheap count of observations awaiting review — for the nav badge (no candidate lookups). */
export async function reviewQueueCount(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: count() })
    .from(priceObservation)
    .where(eq(priceObservation.needsReview, true));
  return row?.n ?? 0;
}

export async function listReviewQueue(limit = 50): Promise<ReviewItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      observationId: priceObservation.id,
      rawSignalId: priceObservation.rawSignalId,
      rawText: rawSignal.rawText,
      extracted: priceObservation.extracted,
      priceVnd: priceObservation.priceVnd,
      confidence: priceObservation.confidence,
    })
    .from(priceObservation)
    .innerJoin(rawSignal, eq(rawSignal.id, priceObservation.rawSignalId))
    .where(eq(priceObservation.needsReview, true))
    .orderBy(desc(priceObservation.createdAt))
    .limit(limit);

  const items: ReviewItem[] = [];
  for (const r of rows) {
    const extraction = PropertyExtraction.parse(r.extracted);
    items.push({
      observationId: r.observationId,
      rawSignalId: r.rawSignalId,
      rawText: r.rawText,
      extraction,
      priceVnd: r.priceVnd,
      confidence: r.confidence != null ? Number(r.confidence) : null,
      candidates: await findCandidates(extraction),
    });
  }
  return items;
}

export type ReviewAction =
  | { action: "link"; propertyId: string }
  | { action: "create" }
  | { action: "dismiss" };

/** Apply a reviewer decision to a queued observation, then refresh the signal status. */
export async function applyReview(observationId: string, decision: ReviewAction): Promise<void> {
  // Create-property + observation update + signal-status refresh are one atomic unit.
  await transaction(async (tx) => {
    const obs = await tx.query.priceObservation.findFirst({
      columns: { id: true, rawSignalId: true, extracted: true },
      where: eq(priceObservation.id, observationId),
    });
    if (!obs) throw new Error("observation not found");

    let propertyId: string | null = null;
    if (decision.action === "link") {
      propertyId = decision.propertyId;
    } else if (decision.action === "create") {
      propertyId = await createPropertyFromExtraction(PropertyExtraction.parse(obs.extracted), tx);
    }

    await tx
      .update(priceObservation)
      .set({ propertyId, needsReview: false })
      .where(eq(priceObservation.id, observationId));

    await refreshSignalStatus(obs.rawSignalId, tx);
  });
}

/** Mark the signal 'extracted' once none of its observations still need review. */
async function refreshSignalStatus(rawSignalId: string, db: DbExecutor = getDb()): Promise<void> {
  const remaining = await db.query.priceObservation.findFirst({
    columns: { id: true },
    where: and(eq(priceObservation.rawSignalId, rawSignalId), eq(priceObservation.needsReview, true)),
  });
  if (!remaining) {
    await db.update(rawSignal).set({ status: "extracted" }).where(eq(rawSignal.id, rawSignalId));
  }
}

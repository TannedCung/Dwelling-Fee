import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, transaction } from "../../db/client";
import { rawSignal } from "../../db/schema";
import { extract } from "../extraction/extract";
import { persistDraft } from "./persist";

export * from "./session";
export * from "./agent";
export * from "./commit";
export { persistDraft, derivePricePerM2, REVIEW_CONFIDENCE_THRESHOLD } from "./persist";

export interface IngestResult {
  rawSignalId: string;
  duplicate: boolean;
  observationsCreated: number;
  autoLinked: number;
  created: number;
  needsReview: number;
}

/**
 * One-shot, non-conversational ingest: store text, extract, resolve, write. Used
 * by the programmatic API and (later) the collection agent. The interactive path
 * lives in agent.ts + commit.ts.
 */
export async function ingestSignal(input: {
  rawText: string;
  sourceType?: "broker" | "web" | "agent" | "user";
  sourceRef?: string | null;
}): Promise<IngestResult> {
  const source = input.sourceType ?? "broker";
  const sourceRef = input.sourceRef ?? null;
  const contentHash = createHash("sha256").update(input.rawText.trim()).digest("hex");
  const empty = { duplicate: true as const, observationsCreated: 0, autoLinked: 0, created: 0, needsReview: 0 };

  // Cheap dedup check first — also avoids paying for extraction on a known signal.
  const existing = await getDb().query.rawSignal.findFirst({
    columns: { id: true },
    where: (s, { and, eq, isNull }) =>
      and(
        eq(s.sourceType, source),
        sourceRef == null ? isNull(s.sourceRef) : eq(s.sourceRef, sourceRef),
        eq(s.contentHash, contentHash),
      ),
  });
  if (existing) return { rawSignalId: existing.id, ...empty };

  // Extraction is the slow/expensive step — run it OUTSIDE the transaction so we
  // never hold a pooled DB connection open across an LLM call.
  const { properties } = await extract(input.rawText);

  // Signal insert + observations + status update are atomic.
  return transaction(async (tx) => {
    const inserted = await tx
      .insert(rawSignal)
      .values({ sourceType: source, sourceRef, contentHash, rawText: input.rawText })
      .onConflictDoNothing({ target: [rawSignal.sourceType, rawSignal.sourceRef, rawSignal.contentHash] })
      .returning({ id: rawSignal.id });

    if (inserted.length === 0) {
      // Lost a race with a concurrent ingest of the same signal — don't double-write.
      const raced = await tx.query.rawSignal.findFirst({
        columns: { id: true },
        where: (s, { and, eq, isNull }) =>
          and(
            eq(s.sourceType, source),
            sourceRef == null ? isNull(s.sourceRef) : eq(s.sourceRef, sourceRef),
            eq(s.contentHash, contentHash),
          ),
      });
      return { rawSignalId: raced!.id, ...empty };
    }

    const signalId = inserted[0]!.id;
    const result = await persistDraft(properties, { rawSignalId: signalId, sourceType: source }, tx);

    await tx
      .update(rawSignal)
      .set({ status: result.needsReview > 0 ? "needs_review" : "extracted" })
      .where(eq(rawSignal.id, signalId));

    return { rawSignalId: signalId, duplicate: false, ...result };
  });
}

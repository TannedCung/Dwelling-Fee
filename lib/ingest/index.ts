import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
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
  const result = await persistDraft(properties, { rawSignalId: signalId, sourceType: source });

  await db
    .update(rawSignal)
    .set({ status: result.needsReview > 0 ? "needs_review" : "extracted" })
    .where(eq(rawSignal.id, signalId));

  return { rawSignalId: signalId, duplicate: false, ...result };
}

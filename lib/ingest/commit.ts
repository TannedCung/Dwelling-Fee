import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { transaction } from "../../db/client";
import { rawSignal, ingestSession } from "../../db/schema";
import { getSession, userSourceText, userAttachments, addMessage } from "./session";
import { persistDraft, type PersistResult } from "./persist";
import { draftReady, incompleteSummary } from "../extraction/completeness";
import { persistableAttachments } from "../storage/r2";

export interface CommitResult extends PersistResult {
  rawSignalId: string;
}

/**
 * Commit a session's draft: create the provenance-anchored raw_signal (the human
 * source text), run resolution + write observations tagged with this session, and
 * close the session. Idempotent on the raw text via the content-hash constraint.
 */
export async function commitSession(sessionId: string): Promise<CommitResult> {
  // Reads (transcript + draft) happen before the transaction; they don't need to
  // be atomic and shouldn't hold a pooled connection open.
  const session = await getSession(sessionId);
  if (!session) throw new Error("session not found");
  if (session.status !== "open") throw new Error("session is not open");
  if (session.draft.length === 0) throw new Error("draft is empty — nothing to commit");
  // Hard gate: never commit a property that lacks required information (§ ingest purpose).
  if (!draftReady(session.draft)) {
    throw new Error(`Cannot commit — missing required info:\n${incompleteSummary(session.draft).join("\n")}`);
  }

  const attachments = await userAttachments(sessionId);
  const textOnly = await userSourceText(sessionId);
  const attachmentText = attachments.map((a) => `[image: ${a.filename}] ${a.url}`).join("\n");
  const text = [textOnly, attachmentText].filter(Boolean).join("\n\n") || `(ingest session ${sessionId})`;
  const contentHash = createHash("sha256").update(text.trim()).digest("hex");

  // Signal + observations + session close + audit message are one atomic unit: a
  // partial failure must not leave observations written against an open session.
  return transaction(async (tx) => {
    const inserted = await tx
      .insert(rawSignal)
      .values({
        sourceType: session.sourceType,
        contentHash,
        rawText: text,
        attachments: attachments.length > 0 ? persistableAttachments(attachments) : null,
        ingestSessionId: sessionId,
        status: "extracted",
      })
      .onConflictDoNothing({ target: [rawSignal.sourceType, rawSignal.sourceRef, rawSignal.contentHash] })
      .returning({ id: rawSignal.id });

    let rawSignalId: string;
    if (inserted.length > 0) {
      rawSignalId = inserted[0]!.id;
    } else {
      const existing = await tx.query.rawSignal.findFirst({
        columns: { id: true },
        where: (s, { and, eq, isNull }) =>
          and(eq(s.sourceType, session.sourceType), isNull(s.sourceRef), eq(s.contentHash, contentHash)),
      });
      rawSignalId = existing!.id;
    }

    const result = await persistDraft(
      session.draft,
      { rawSignalId, ingestSessionId: sessionId, sourceType: session.sourceType },
      tx,
    );

    await tx
      .update(ingestSession)
      .set({ status: "committed", committedAt: new Date(), updatedAt: new Date() })
      .where(eq(ingestSession.id, sessionId));

    await addMessage(
      sessionId,
      "assistant",
      `Committed ${result.observationsCreated} observation(s): ${result.autoLinked} linked, ${result.created} new propert${result.created === 1 ? "y" : "ies"}, ${result.needsReview} sent to review.`,
      tx,
    );

    return { rawSignalId, ...result };
  });
}

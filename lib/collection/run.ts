import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { collectionSource, collectionRun } from "../../db/schema";
import { ingestSignal } from "../ingest";
import { fetcherFor, type CollectionSourceRef } from "./fetchers";

/**
 * Execute one collection source: fetch its items and push each through the same
 * ingestSignal() pipeline used for broker messages. Idempotent — re-running a
 * source re-fetches the same stable sourceRefs, which raw_signal dedups, so only
 * genuinely-new items create observations. Every run is recorded for observability.
 */
export interface RunSummary {
  sourceId: string;
  status: "ok" | "error";
  itemsFetched: number;
  signalsNew: number;
  signalsDuplicate: number;
  observationsCreated: number;
  error?: string;
}

export async function runSource(sourceId: string): Promise<RunSummary> {
  const db = getDb();
  const source = await db.query.collectionSource.findFirst({ where: eq(collectionSource.id, sourceId) });
  if (!source) throw new Error("collection source not found");

  const [run] = await db
    .insert(collectionRun)
    .values({ sourceId, status: "ok" })
    .returning({ id: collectionRun.id });
  const runId = run!.id;

  const summary: RunSummary = {
    sourceId,
    status: "ok",
    itemsFetched: 0,
    signalsNew: 0,
    signalsDuplicate: 0,
    observationsCreated: 0,
  };

  try {
    const ref: CollectionSourceRef = {
      id: source.id,
      label: source.label,
      url: source.url,
      kind: source.kind,
      config: source.config,
    };
    const items = await fetcherFor(source.kind).fetch(ref);
    summary.itemsFetched = items.length;

    for (const item of items) {
      const res = await ingestSignal({
        rawText: item.text,
        sourceType: "agent",
        sourceRef: item.sourceRef,
      });
      if (res.duplicate) summary.signalsDuplicate++;
      else {
        summary.signalsNew++;
        summary.observationsCreated += res.observationsCreated;
      }
    }
  } catch (e) {
    summary.status = "error";
    summary.error = e instanceof Error ? e.message : "collection failed";
  }

  const finishedAt = new Date();
  await db
    .update(collectionRun)
    .set({
      status: summary.status,
      itemsFetched: summary.itemsFetched,
      signalsNew: summary.signalsNew,
      signalsDuplicate: summary.signalsDuplicate,
      observationsCreated: summary.observationsCreated,
      error: summary.error ?? null,
      finishedAt,
    })
    .where(eq(collectionRun.id, runId));
  await db
    .update(collectionSource)
    .set({
      lastRunAt: finishedAt,
      lastStatus: summary.status,
      lastError: summary.error ?? null,
      lastItemCount: summary.itemsFetched,
    })
    .where(eq(collectionSource.id, sourceId));

  return summary;
}

/** Run every enabled source — the scheduled (Cron) entrypoint. */
export async function runDueSources(): Promise<{ runs: RunSummary[] }> {
  const db = getDb();
  const sources = await db
    .select({ id: collectionSource.id })
    .from(collectionSource)
    .where(eq(collectionSource.enabled, true));
  const runs: RunSummary[] = [];
  for (const s of sources) {
    try {
      runs.push(await runSource(s.id));
    } catch (e) {
      runs.push({
        sourceId: s.id,
        status: "error",
        itemsFetched: 0,
        signalsNew: 0,
        signalsDuplicate: 0,
        observationsCreated: 0,
        error: e instanceof Error ? e.message : "run failed",
      });
    }
  }
  return { runs };
}

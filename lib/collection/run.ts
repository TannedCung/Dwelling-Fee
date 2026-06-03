import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { collectionSource, collectionRun, collectionPage } from "../../db/schema";
import { ensureCollectionSchema } from "../db/ensure-schema";
import { ingestSignal } from "../ingest";
import {
  fetcherFor,
  type CollectionFetchResult,
  type CollectionPageCacheEntry,
  type CollectionPageResult,
  type CollectionSourceRef,
} from "./fetchers";

/**
 * Execute one collection source: fetch its items and push each through the same
 * ingestSignal() pipeline used for broker messages. Idempotent — re-running a
 * source re-fetches the same stable sourceRefs, which raw_signal dedups, so only
 * genuinely-new items create observations. Every run is recorded for observability.
 */
export interface RunSummary {
  sourceId: string;
  status: "ok" | "error";
  pagesFetched: number;
  pagesSkippedUnchanged: number;
  pagesFailed: number;
  bytesFetched: number;
  itemsFetched: number;
  itemsExtracted: number;
  signalsNew: number;
  signalsDuplicate: number;
  observationsCreated: number;
  error?: string;
}

export async function runSource(sourceId: string): Promise<RunSummary> {
  await ensureCollectionSchema();
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
    pagesFetched: 0,
    pagesSkippedUnchanged: 0,
    pagesFailed: 0,
    bytesFetched: 0,
    itemsFetched: 0,
    itemsExtracted: 0,
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
    const fetched = await fetcherFor(source.kind).fetch(ref, { cachedPages: await cachedPageMap(sourceId) });
    applyFetchMetrics(summary, fetched);
    await persistPageResults(sourceId, fetched.pages);

    for (const item of fetched.items) {
      const res = await ingestSignal({
        rawText: item.text,
        sourceType: item.sourceType ?? (source.kind === "http" ? "web" : "agent"),
        sourceRef: item.sourceRef,
        capturedAt: item.capturedAt ?? null,
      });
      if (item.pageUrl) await markPageRawSignal(sourceId, item.pageUrl, res.rawSignalId);
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
      pagesFetched: summary.pagesFetched,
      pagesSkippedUnchanged: summary.pagesSkippedUnchanged,
      pagesFailed: summary.pagesFailed,
      bytesFetched: summary.bytesFetched,
      itemsFetched: summary.itemsFetched,
      itemsExtracted: summary.itemsExtracted,
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
  await ensureCollectionSchema();
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
        pagesFetched: 0,
        pagesSkippedUnchanged: 0,
        pagesFailed: 0,
        bytesFetched: 0,
        itemsFetched: 0,
        itemsExtracted: 0,
        signalsNew: 0,
        signalsDuplicate: 0,
        observationsCreated: 0,
        error: e instanceof Error ? e.message : "run failed",
      });
    }
  }
  return { runs };
}

export async function previewSource(sourceId: string): Promise<CollectionFetchResult> {
  await ensureCollectionSchema();
  const db = getDb();
  const source = await db.query.collectionSource.findFirst({ where: eq(collectionSource.id, sourceId) });
  if (!source) throw new Error("collection source not found");
  return fetcherFor(source.kind).fetch(
    { id: source.id, label: source.label, url: source.url, kind: source.kind, config: source.config },
    { cachedPages: await cachedPageMap(sourceId) },
  );
}

function applyFetchMetrics(summary: RunSummary, fetched: CollectionFetchResult): void {
  summary.pagesFetched = fetched.pages.filter((p) => p.status === "fetched").length;
  summary.pagesSkippedUnchanged = fetched.pages.filter((p) => p.status === "skipped_unchanged").length;
  summary.pagesFailed = fetched.pages.filter((p) => p.status === "failed").length;
  summary.bytesFetched = fetched.pages.reduce((sum, page) => sum + (page.bytesFetched ?? 0), 0);
  summary.itemsFetched = fetched.items.length;
  summary.itemsExtracted = fetched.pages.reduce((sum, page) => sum + (page.itemCount ?? 0), 0);
  if (summary.pagesFailed > 0 && summary.pagesFetched === 0 && summary.itemsFetched === 0) {
    summary.status = "error";
    summary.error = fetched.pages.find((p) => p.status === "failed")?.error ?? "collection failed";
  }
}

async function cachedPageMap(sourceId: string): Promise<Map<string, CollectionPageCacheEntry>> {
  const rows = await getDb()
    .select({
      canonicalUrl: collectionPage.canonicalUrl,
      etag: collectionPage.etag,
      lastModified: collectionPage.lastModified,
      contentHash: collectionPage.contentHash,
      textHash: collectionPage.textHash,
    })
    .from(collectionPage)
    .where(eq(collectionPage.sourceId, sourceId));
  return new Map(rows.map((row) => [row.canonicalUrl, row]));
}

async function persistPageResults(sourceId: string, pages: CollectionPageResult[]): Promise<void> {
  const db = getDb();
  for (const page of pages) {
    await db
      .insert(collectionPage)
      .values(insertPageValues(sourceId, page))
      .onConflictDoUpdate({
        target: [collectionPage.sourceId, collectionPage.canonicalUrl],
        set: updatePageValues(page),
      });
  }
}

function insertPageValues(sourceId: string, page: CollectionPageResult) {
  const now = new Date();
  return {
    sourceId,
    canonicalUrl: page.canonicalUrl,
    httpStatus: page.httpStatus ?? null,
    contentHash: page.contentHash ?? null,
    textHash: page.textHash ?? null,
    etag: page.etag ?? null,
    lastModified: page.lastModified ?? null,
    fetchDurationMs: page.fetchDurationMs ?? null,
    bytesFetched: page.bytesFetched ?? 0,
    textLength: page.textLength ?? 0,
    itemCount: page.itemCount ?? 0,
    lastError: page.error ?? null,
    lastFetchedAt: page.fetchedAt ?? now,
    createdAt: now,
    updatedAt: now,
  };
}

function updatePageValues(page: CollectionPageResult) {
  const values: Record<string, unknown> = {
    lastError: page.error ?? null,
    lastFetchedAt: page.fetchedAt ?? new Date(),
    updatedAt: new Date(),
  };
  if (page.httpStatus !== undefined) values.httpStatus = page.httpStatus;
  if (page.contentHash !== undefined) values.contentHash = page.contentHash;
  if (page.textHash !== undefined) values.textHash = page.textHash;
  if (page.etag !== undefined) values.etag = page.etag;
  if (page.lastModified !== undefined) values.lastModified = page.lastModified;
  if (page.fetchDurationMs !== undefined) values.fetchDurationMs = page.fetchDurationMs;
  if (page.bytesFetched !== undefined) values.bytesFetched = page.bytesFetched;
  if (page.textLength !== undefined) values.textLength = page.textLength;
  if (page.itemCount !== undefined) values.itemCount = page.itemCount;
  return values;
}

async function markPageRawSignal(sourceId: string, canonicalUrl: string, rawSignalId: string): Promise<void> {
  await getDb()
    .update(collectionPage)
    .set({ lastRawSignalId: rawSignalId, updatedAt: new Date() })
    .where(and(eq(collectionPage.sourceId, sourceId), eq(collectionPage.canonicalUrl, canonicalUrl)));
}

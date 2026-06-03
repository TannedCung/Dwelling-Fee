/**
 * Collection fetchers (Phase 3 scaffold). A fetcher turns a registered source
 * into a list of raw text items, each with a stable `sourceRef` so re-runs are
 * idempotent (raw_signal dedups on source_type + source_ref + content_hash).
 *
 * The `http` fetcher is a guarded crawler with robots checks, source-domain
 * allowlisting, and a source-level max-page cap.
 */

import { httpFetcher } from "./http-fetcher";

export interface CollectionSourceRef {
  id: string;
  label: string;
  url: string;
  kind: "stub" | "http";
  config: unknown;
}

export type CollectionSourceType = "broker" | "web" | "agent" | "user";

export interface CollectedItem {
  /** Stable identifier for this item within the source — drives idempotency. */
  sourceRef: string;
  /** Raw listing text, fed verbatim into ingestSignal(). */
  text: string;
  /** Canonical page URL that produced this item, when available. */
  pageUrl?: string;
  /** Source type persisted into raw_signal / price_observation. */
  sourceType?: CollectionSourceType;
  capturedAt?: Date;
}

export interface CollectionPageCacheEntry {
  canonicalUrl: string;
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
  textHash: string | null;
}

export interface CollectionFetchContext {
  cachedPages?: Map<string, CollectionPageCacheEntry>;
}

export interface CollectionPageResult {
  canonicalUrl: string;
  status: "fetched" | "skipped_unchanged" | "failed";
  httpStatus?: number;
  contentHash?: string | null;
  textHash?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  fetchDurationMs?: number;
  bytesFetched?: number;
  textLength?: number;
  itemCount?: number;
  error?: string;
  fetchedAt?: Date;
}

export interface CollectionFetchResult {
  items: CollectedItem[];
  pages: CollectionPageResult[];
}

export interface CollectionFetcher {
  fetch(source: CollectionSourceRef, ctx?: CollectionFetchContext): Promise<CollectionFetchResult>;
}

export function fetcherFor(_kind: "stub" | "http"): CollectionFetcher {
  return httpFetcher;
}

/**
 * Shared edge collection result shapes. Edge devices submit raw text items with
 * stable `sourceRef` values so raw_signal can deduplicate across runs.
 */

export type CollectionSourceType = "broker" | "web" | "agent" | "user";

export interface CollectedItem {
  /** Stable identifier for this item within the source — drives idempotency. */
  sourceRef: string;
  /** Raw listing text submitted by the edge device; the server distills it before ingest. */
  text: string;
  /** Canonical page URL that produced this item, when available. */
  pageUrl?: string;
  /** Source type persisted into raw_signal / price_observation. */
  sourceType?: CollectionSourceType;
  capturedAt?: Date;
}

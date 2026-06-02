import {
  pgTable, pgEnum, uuid, text, jsonb, integer, numeric, bigint, boolean,
  timestamp, customType, unique, index, type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Postgres schema for the Housing Price Intelligence System.
 * Mirrors docs/design.md §6. Requires the `postgis` and `vector` extensions
 * (see db/extensions.sql) — run those before the first migration.
 */

// PostGIS / pgvector columns. Modeled as custom types so we don't depend on a
// specific drizzle geometry/vector API version; values round-trip as text (WKT/EWKT)
// for geometry and number[] for the embedding.
const pointGeometry = customType<{ data: string }>({ dataType: () => "geometry(Point, 4326)" });
const multiPolygonGeometry = customType<{ data: string }>({ dataType: () => "geometry(MultiPolygon, 4326)" });
const vector = (dims: number) => customType<{ data: number[] }>({ dataType: () => `vector(${dims})` });
const EMBEDDING_DIMS = 1536; // pin model dimension; changing it requires a re-embed (design §8)

export const sourceType = pgEnum("source_type", ["broker", "web", "agent", "user"]);
export const signalStatus = pgEnum("signal_status", ["pending", "extracted", "needs_review", "failed", "ignored"]);
export const propertyType = pgEnum("property_type", ["apartment", "house", "project", "land", "unknown"]);
export const listingType = pgEnum("listing_type", ["sale", "rent", "unknown"]);
export const dealStatus = pgEnum("deal_status", ["asking", "transacted", "unknown"]);
export const priceBasis = pgEnum("price_basis", ["total", "per_m2", "unknown"]);
export const locationLevel = pgEnum("location_level", ["city", "district", "ward", "street", "zone"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed"]);

// ── raw_signal — immutable, provenance-preserving input ─────────────────────
export const rawSignal = pgTable(
  "raw_signal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: sourceType("source_type").notNull(),
    sourceRef: text("source_ref"), // url, chat id, broker contact id
    contentHash: text("content_hash").notNull(), // sha256(normalized raw_text) — idempotency
    rawText: text("raw_text").notNull(),
    attachments: jsonb("attachments"), // Vercel Blob urls
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
    status: signalStatus("status").default("pending").notNull(),
    // The conversational ingest session that produced this signal (null for one-shot ingest).
    ingestSessionId: uuid("ingest_session_id").references((): AnyPgColumn => ingestSession.id),
  },
  (t) => [unique("raw_signal_dedup").on(t.sourceType, t.sourceRef, t.contentHash)],
);

// ── broker_contact — source entity (PII boundary) ───────────────────────────
export const brokerContact = pgTable("broker_contact", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  phone: text("phone"), // PII: encrypt at rest / restrict access (design §10)
  channel: text("channel"), // 'zalo' | 'messenger' | 'web' | ...
  reputation: jsonb("reputation"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── location — geo aggregation entity ───────────────────────────────────────
export const location = pgTable(
  "location",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    level: locationLevel("level").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => location.id),
    geom: multiPolygonGeometry("geom"),
    stats: jsonb("stats"), // cached per-segment {median_ppm2, p25, p75, n, updated_at}
  },
  (t) => [index("location_geom_idx").using("gist", t.geom)],
);

// ── property — durable entity ("living page") ───────────────────────────────
export const property = pgTable(
  "property",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // self-ref: null = canonical; otherwise points at the surviving record after a merge
    canonicalPropertyId: uuid("canonical_property_id").references((): AnyPgColumn => property.id),
    name: text("name"),
    // Diacritic-stripped, lowercased name used as a blocking key for entity resolution (§5).
    nameNormalized: text("name_normalized"),
    type: propertyType("type").default("unknown").notNull(),
    locationId: uuid("location_id").references(() => location.id),
    geom: pointGeometry("geom"),
    addressText: text("address_text"),
    yearBuilt: integer("year_built"),
    renovationYear: integer("renovation_year"),
    attributes: jsonb("attributes"), // beds, baths, floors, legal status...
    embedding: vector(EMBEDDING_DIMS)("embedding"), // nullable; populated in Phase 3
    wikiNotes: text("wiki_notes"),
    aiSummary: text("ai_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("property_geom_idx").using("gist", t.geom),
    index("property_name_norm_idx").on(t.nameNormalized),
  ],
);

// ── price_observation — append-only time-series facts ───────────────────────
export const priceObservation = pgTable(
  "price_observation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // nullable until entity resolution links it; points at canonical after merge
    propertyId: uuid("property_id").references(() => property.id),
    rawSignalId: uuid("raw_signal_id").references(() => rawSignal.id).notNull(),
    // Conversation provenance: the ingest session this observation was drafted in (null for one-shot).
    ingestSessionId: uuid("ingest_session_id").references((): AnyPgColumn => ingestSession.id),
    brokerContactId: uuid("broker_contact_id").references(() => brokerContact.id),
    priceVnd: bigint("price_vnd", { mode: "number" }),
    areaM2: numeric("area_m2"),
    pricePerM2: numeric("price_per_m2"), // derived
    priceBasis: priceBasis("price_basis").default("unknown").notNull(),
    listingType: listingType("listing_type").default("unknown").notNull(),
    dealStatus: dealStatus("deal_status").default("unknown").notNull(),
    isNegotiable: boolean("is_negotiable").default(false).notNull(),
    sourceType: sourceType("source_type").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    confidence: numeric("confidence"),
    needsReview: boolean("needs_review").default(false).notNull(),
    extracted: jsonb("extracted"), // full extraction payload
    extractor: text("extractor"), // model + prompt version, for reproducibility
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("obs_property_time_idx").on(t.propertyId, t.observedAt),
    index("obs_segment_time_idx").on(t.dealStatus, t.listingType, t.observedAt),
  ],
);

// ── property_merge — reversible merge audit log ─────────────────────────────
export const propertyMerge = pgTable("property_merge", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromId: uuid("from_id").references(() => property.id).notNull(),
  intoId: uuid("into_id").references(() => property.id).notNull(),
  reason: text("reason"), // 'auto' | 'human' | score
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
});

// ── extraction_job — observability + retry / DLQ ────────────────────────────
export const extractionJob = pgTable("extraction_job", {
  id: uuid("id").primaryKey().defaultRandom(),
  rawSignalId: uuid("raw_signal_id").references(() => rawSignal.id).notNull(),
  status: jobStatus("status").default("queued").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  error: text("error"),
  costUsd: numeric("cost_usd"),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

// ── geocode_cache — memoized geocoding results (incl. negative results) ─────
// Vietnamese addresses are hard and providers are rate-limited; cache every
// lookup (a null lat/lng means "looked up, not found") so we never re-query.
export const geocodeCache = pgTable("geocode_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  query: text("query").notNull().unique(),
  lat: numeric("lat"),
  lng: numeric("lng"),
  displayName: text("display_name"),
  provider: text("provider"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── ingest_session — conversational drafting workspace ──────────────────────
// A session holds an evolving DRAFT (PropertyExtraction[]) built through chat,
// and is the provenance anchor for the observations committed from it.
export const ingestSessionStatus = pgEnum("ingest_session_status", ["open", "committed", "abandoned"]);
export const ingestRole = pgEnum("ingest_role", ["user", "assistant"]);

export const ingestSession = pgTable("ingest_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: ingestSessionStatus("status").default("open").notNull(),
  sourceType: sourceType("source_type").default("broker").notNull(),
  brokerContactId: uuid("broker_contact_id").references(() => brokerContact.id),
  title: text("title"), // short human-readable label, derived from the first paste
  draft: jsonb("draft"), // current PropertyExtraction[] being assembled
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
});

// ── ingest_message — the chat transcript (context + provenance) ─────────────
export const ingestMessage = pgTable(
  "ingest_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").references(() => ingestSession.id).notNull(),
    role: ingestRole("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ingest_message_session_idx").on(t.sessionId, t.createdAt)],
);

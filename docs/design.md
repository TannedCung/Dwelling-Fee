# Dwelling Fee — Housing Price Intelligence System

> Consolidated product & architecture design. Supersedes `initial_design.md`.
> Target deployment: **Vercel (app + functions) + Neon (Postgres) + serverless services.**

---

## 0. The Real Problem (read this first)

It is tempting to see this as "scrape listings → store in Postgres → draw a heatmap." That is
the easy 20%. The product succeeds or fails on three hard problems that the CRUD layer hides:

1. **Extraction** — turning messy, abbreviated, multilingual (Vietnamese) broker chatter into
   correct structured facts. *Garbage in, garbage everywhere.*
2. **Entity resolution** — deciding that "Vinhomes Q9 căn 2PN tầng 12" from broker A and a web
   post are the *same* property — or aren't. This is the single hardest part of the system.
3. **Statistical honesty** — a median price/m² that silently mixes rent, asking, and transacted
   prices across an over-broad area is *confidently wrong*. The product's credibility dies here.

Everything below is organized so these three get first-class treatment instead of a footnote.
**De-risk them before building the agent or the pretty charts.** (See Phase 0, §11.)

---

## 1. Product Vision

A real estate market intelligence system that collects **fragmented housing price signals** and
turns them into structured, queryable market intelligence — so a buyer can reason about *what a
home is actually worth* instead of trusting a single asking price.

It transforms raw signals into:

- Structured property intelligence (per-property "living pages")
- **Price distributions over time**, not single point values
- Geo heatmaps of housing value
- Market "price clouds" showing activity, volatility, and liquidity

**Goal:** support a real buying decision — find under/over-valued areas and properties, and
understand price ranges *with confidence and provenance* rather than guessing.

Core organizing idea:
> **Entity-based wiki + structured database + spatiotemporal analytics layer.**

---

## 2. Core Principles

- **Entity-first.** Durable entities are Property/Building/Project and Location (with geometry).
  Each is a *living page* aggregating structured data, raw signals, history, references, summary.
- **Multi-source truth.** No single price. Many observations, many sources, over time. Store
  **distributions, not values**, and **always keep provenance** back to the raw text.
- **Append-only facts.** Observations are never overwritten or deleted. Corrections and merges
  happen at the *entity* level and are **reversible and audited**.
- **Confidence is a first-class field.** Every extracted fact carries a confidence and a link to
  the model/version that produced it. Low-confidence facts are quarantined, not silently trusted.
- **Spatial + temporal** are the two analytical axes: map/heatmap (where), scatter/distribution
  (when).

---

## 3. Input Sources (two pipelines, one artifact)

Both pipelines converge on a single artifact: a **`raw_signal`** = unstructured text + metadata.
Everything downstream treats broker and web input identically.

### 3.1 Broker messages (human-collected) — primary today
- Users paste/import raw chat (Zalo, Messenger, SMS, screenshots → OCR → text).
- Messy, partial, **often multiple properties per message**, mixed VI/EN, abbreviations
  (`2PN` = 2 bedrooms, `sổ hồng/SHR` = land title, `tỷ` = billion VND, `TL` = negotiable).
- Stored verbatim; never mutated.
- **Ingested conversationally** (not one-shot): a human pastes into an **ingest session**, the
  assistant extracts a **draft** and asks clarifying questions, the human refines through chat,
  then **commits**. The session is the provenance anchor — committed observations link back to it
  (`price_observation.ingest_session_id`) and to the source text (`raw_signal`). The one-shot path
  (`lib/ingest` → `ingestSignal`) is retained for the future collection agent (§3.2).

### 3.2 Collection agent (internet) — first-class, not "future"
- Crawls real-estate listing sites and forums on a **schedule** and on-demand.
- Optionally drafts broker outreach — **human-approved before sending** (see Risk §10).
- **Idempotent:** re-crawling the same post must not create duplicate signals (content hash).

> ⚠️ Scraping and broker outreach carry legal/ToS/PII risk. This is a design constraint, not an
> afterthought — see §10.

---

## 4. System Layers

```
(1) INPUT        broker paste/OCR │ collection agent │ user edits
(2) PROCESSING   extract (LLM) → normalize → geocode → resolve entity → quarantine/review
(3) ENTITY/WIKI  property & location living pages, summaries, notes, broker contacts
(4) DATABASE     Neon Postgres + PostGIS + pgvector
(5) ANALYTICS    segmented distributions, medians, trends, volatility, valuation
(6) VISUALIZATION  map, heatmap, scatter, distribution bands
        ▲
(0) QUALITY      eval harness, HITL review queue, metrics, cost tracking  ← cross-cutting
```

### (2) Processing — the heart of the system
A multi-step, **durable** pipeline (one step can fail/retry without redoing the rest):

1. **Dedup the signal** — content hash; skip if already ingested.
2. **Extract** — LLM returns structured fields *per property mentioned* (one signal → N candidate
   observations) with per-field confidence. Use a cheap model (Haiku) here; reserve Opus for
   summaries.
3. **Normalize** — currency → VND (int), area → m², derive price/m², classify `price_basis`,
   `listing_type`, `deal_status`, `is_negotiable`.
4. **Geocode** — location text → lat/lng + matched `location` (Vietnamese addresses are hard;
   cache aggressively; handle admin-boundary changes).
5. **Resolve entity** — match to existing `property` or create one (§5). Ambiguous matches go to
   the **review queue**, not auto-merged.
6. **Quarantine** — observations below a confidence threshold are flagged `needs_review` and
   excluded from analytics until a human confirms.

### (3) Entity / Wiki
Property and Location living pages: profile, aggregated observations, broker notes, external
refs, AI summary that refreshes (cheaply, debounced) as new signals arrive. Broker **contacts**
are their own entity (reputation, dedup, PII boundary).

### (4) Database
Neon Postgres. Extensions: **PostGIS** (geometry), **pgvector** (entity matching / dedup).
PostGIS/pgvector queries run on **Node** functions, not Edge. See schema §6.

---

## 5. Entity Resolution (the hard part — designed, not hand-waved)

Naive "embedding similarity > threshold" will silently merge distinct units and split identical
ones. Use a standard record-linkage pipeline:

1. **Blocking (cheap candidate gen):** restrict comparisons to plausible matches — same
   geocoded ward / within radius, or same normalized project name. Avoids O(n²).
2. **Scoring:** combine signals — geo distance, name/address fuzzy match, attribute overlap
   (floor, beds, area band), and embedding cosine similarity. Weighted score, not a single metric.
3. **Decision bands:**
   - high score → **auto-link** to existing property
   - mid score → **review queue** (human adjudicates)
   - low score → **create new** property
4. **Merge is reversible & audited:** soft-merge via `canonical_property_id` + a `property_merge`
   log. Brokers conflate distinct units and split identical ones; unmerge must be a button.
5. **Granularity decision:** is the entity the *building/project* or the *individual unit*? Default
   recommendation: **project + unit attributes on the observation**, since most signals describe a
   unit but identify it only by project + floor/area. (Open decision §12.)

Start with **deterministic blocking + rules**; add embeddings only once you have a labeled set to
tune thresholds against. Don't pay for pgvector before it earns its place.

---

## 6. Data Model

Money stored as integer **VND** (never float). Area `numeric`. All extracted facts trace to a
`raw_signal` and an extractor version for reproducibility.

### `raw_signal` — provenance-preserving input (immutable)
```sql
id              uuid pk
source_type     text         -- 'broker'|'web'|'agent'|'user'
source_ref      text         -- url, chat id, broker contact id
content_hash    text         -- sha256(normalized raw_text); idempotency key
raw_text        text
attachments     jsonb        -- Vercel Blob urls (screenshots)
captured_at     timestamptz  -- when the signal was authored/observed
ingested_at     timestamptz default now()
status          text         -- 'pending'|'extracted'|'needs_review'|'failed'|'ignored'
unique (source_type, source_ref, content_hash)
```

### `broker_contact` — source entity (PII boundary)
```sql
id              uuid pk
name            text
phone           text         -- PII: encrypt at rest / restrict access
channel         text         -- 'zalo'|'messenger'|'web'|...
reputation      jsonb        -- signal counts, reliability score
created_at      timestamptz default now()
```

### `property` — durable entity ("living page")
```sql
id                    uuid pk
canonical_property_id uuid fk -> property   -- self-ref; null = canonical
name                  text
type                  text     -- 'apartment'|'house'|'project'|'land'
location_id           uuid fk -> location
geom                  geometry(Point,4326)
address_text          text
year_built            int
renovation_year       int
attributes            jsonb    -- beds, baths, floors, legal status...
embedding             vector   -- nullable; added in Phase 3
wiki_notes            text
ai_summary            text
created_at            timestamptz default now()
updated_at            timestamptz
```

### `price_observation` — time-series facts (append-only)
```sql
id              uuid pk
property_id     uuid fk -> property        -- points at canonical after merge
raw_signal_id   uuid fk -> raw_signal      -- one signal → many observations
broker_contact_id uuid fk -> broker_contact null
price_vnd       bigint
area_m2         numeric
price_per_m2    numeric                    -- generated/derived
price_basis     text     -- 'total'|'per_m2'
listing_type    text     -- 'sale'|'rent'
deal_status     text     -- 'asking'|'transacted'|'sold'|'unknown'  ← never mix in analytics
is_negotiable   boolean
source_type     text
observed_at     timestamptz                -- semantics: web=post date, broker=message date
confidence      numeric                    -- 0..1
needs_review    boolean default false
extracted       jsonb                      -- full extraction payload
extractor       text                       -- model + prompt version, for reproducibility
created_at      timestamptz default now()
```

### `ingest_session` / `ingest_message` — conversational drafting + provenance
```sql
-- ingest_session: one drafting conversation
id            uuid pk
status        text     -- 'open'|'committed'|'abandoned'
source_type   text
title         text
draft         jsonb    -- current PropertyExtraction[] being assembled
created_at / updated_at / committed_at  timestamptz

-- ingest_message: the chat transcript (context + provenance)
id            uuid pk
session_id    uuid fk -> ingest_session
role          text     -- 'user'|'assistant'
content       text
created_at    timestamptz
```
`raw_signal.ingest_session_id` and `price_observation.ingest_session_id` tie committed facts back
to the conversation that produced them.

### `location` — geo aggregation entity
```sql
id        uuid pk
name      text
level     text     -- 'city'|'district'|'ward'|'street'|'zone'
parent_id uuid fk -> location
geom      geometry(MultiPolygon,4326)
stats     jsonb    -- cached: {segment: {median_ppm2,p25,p75,n,updated_at}}  ← segmented
```

### `property_merge` — audit log (reversible)
```sql
id           uuid pk
from_id      uuid     -- merged-away property
into_id      uuid     -- canonical
reason       text     -- 'auto'|'human'|score
actor        text
created_at   timestamptz default now()
undone_at    timestamptz
```

### `extraction_job` — observability + retry (DLQ)
```sql
id            uuid pk
raw_signal_id uuid fk -> raw_signal
status        text     -- 'queued'|'running'|'succeeded'|'failed'
attempts      int default 0
error         text
cost_usd      numeric  -- token cost tracking
model         text
created_at    timestamptz
finished_at   timestamptz
```

**Indexes:** GiST on `geom`; btree on `price_observation(property_id, observed_at)` and
`(deal_status, listing_type, observed_at)`; HNSW on `embedding` (Phase 3).

---

## 7. Analytics — with statistical honesty

Rules that keep the numbers defensible:

- **Never aggregate across segments.** Always partition by `(listing_type, deal_status,
  property_type)` before computing a median. Mixing rent + sale, or asking + transacted, is the
  fastest way to ship a confidently wrong number.
- **Sample-size guard.** Suppress (or visibly caveat) any statistic with `n` below a floor
  (e.g. n < 5). Show `n` everywhere.
- **Asking ≠ transacted.** Listings are an *offer* distribution with selection bias; transacted
  prices are scarce and gold. Track and display them separately; never blend.
- **Recency weighting** for "current" estimates; raw scatter for history.
- **Robust stats:** median + p25/p75 (IQR), not mean ± stddev — the data is heavy-tailed and noisy.
- Outputs: price/m² distribution per area+window, trend, volatility (IQR width), liquidity
  (observation density), under/over-valuation = observation vs local robust baseline.

---

## 8. Technical Architecture (serverless)

| Concern | Choice | Notes |
|---|---|---|
| App + API | **Next.js (App Router) on Vercel** | UI, route handlers, server actions |
| Database | **Neon Postgres** | serverless, branchable; PostGIS + pgvector |
| DB access | **Drizzle ORM** + Neon driver | HTTP driver for short reads; **pooled** for jobs/migrations |
| Auth | **Neon Auth** (recommended) or Clerk | small private user set |
| LLM access | **Vercel AI SDK** + provider registry | provider-agnostic; `generateObject` for structured extraction |
| LLM provider | **Anthropic / OpenAI / Gemini** (env-selectable) | extraction tier: Haiku 4.5 / gpt-4.1-mini / gemini-2.5-flash |
| Summaries | larger model of chosen provider | living-page summaries; debounced, not per-signal |
| Embeddings | embeddings → `pgvector` | Phase 3 only; pin model+dim (re-embed on change) |
| Durable jobs | **Inngest** or **Vercel Workflow (WDK)** | extraction/crawl exceed function timeout; need steps+retries+DLQ |
| Schedule | **Vercel Cron** → enqueue job | periodic crawl kickoff |
| Crawling | **Firecrawl/Browserless** or **Vercel Sandbox** | JS-rendered, bot-protected sites |
| OCR | screenshot → text | for broker screenshots (Phase 2) |
| Maps | **MapLibre + deck.gl** | heatmaps, large point layers |
| Charts | **Observable Plot** / visx | scatter + distribution bands |
| Blob storage | **Vercel Blob** | uploaded screenshots |

**Why durable jobs are non-negotiable:** crawl + multi-step LLM extraction is long-running, must
survive partial failure, and needs idempotent retries + a dead-letter for `failed` signals. It
runs as **durable steps triggered by Cron or user action — never inline in a request.**

**Cost control** (LLM spend is the recurring bill): idempotency (never re-extract same hash),
model tiering (Haiku extract / Opus summarize), debounced summaries, prompt caching, batch where
possible, and `extraction_job.cost_usd` tracking with a budget alert.

---

## 9. Visualization

❌ Avoid line charts as the primary view; ✅ use **scatter + distribution**. A line implies a
single truth; housing data is a noisy multi-source cloud.

- **A. Price scatter (primary)** — X=time, Y=price/m²; color=source, size=area, opacity=confidence.
- **B. Distribution bands** — per window: median + p25–p75 band; outliers separate; show `n`.
- **C. Heatmap (spatial)** — price/m² intensity; under/over-valuation map.
- **D. Volatility cloud** — dense = active market; sparse = low liquidity.

Always render provenance (click a point → raw signal) and the confidence/segment it belongs to.

---

## 10. Risks & Compliance (staff-level concerns)

- **Scraping ToS / robots.txt** — many listing sites forbid scraping. Respect robots, rate-limit,
  identify the bot, prefer official APIs/feeds where they exist. Treat as legal risk, not just tech.
- **Broker outreach = spam/ban risk** — auto-messaging Zalo/Messenger risks account bans and is
  borderline unsolicited contact. **Human-approval gate**, throttling, opt-out tracking.
- **PII** — broker phone numbers and personal posts are personal data. Encrypt sensitive fields,
  restrict access, define retention. Don't republish scraped PII.
- **Data poisoning / fake listings** — brokers inflate/anchor prices; bait listings exist. Confidence
  scoring, broker reputation, and outlier detection are defenses, not nice-to-haves.
- **Selection bias** — you only see *listed* and *broker-pushed* properties; this is not the market,
  it's the *advertised* market. State this caveat in the UI.
- **Single metro first** to bound geocoding + location seed data and keep the dataset dense enough
  for valid statistics.

---

## 11. Phased Build (de-risk hard problems first)

- **Phase 0 — Extraction & resolution spike (do this first).** Hand-collect ~100 real broker
  messages. Build the extraction prompt + an **eval harness** (golden labels, accuracy metrics).
  Prototype entity resolution on this set. Goal: prove the core works before building infra around it.
- **Phase 1 — Manual ingest + entities + review queue.** Paste UI → extract → normalize → resolve →
  HITL review → property/observation records → property living page. Next.js + Neon on Vercel.
- **Phase 2 — Analytics + viz.** Segmented distributions, medians w/ sample guards, scatter, heatmap.
  OCR for screenshots.
- **Phase 3 — Collection agent.** Durable scheduled crawl (Cron + Inngest/WDK), idempotent signals,
  geocoding at scale, embeddings + tuned resolution thresholds.
- **Phase 4 — Outreach + intelligence.** Human-approved broker outreach, reputation scoring,
  valuation alerts on under-valued finds.

---

## 12. Open Decisions

1. **Entity granularity** — project-level vs unit-level as the durable entity. Recommendation:
   project entity + unit attributes on observations.
2. **Auth** — Neon Auth (all-in-Neon, recommended for a private tool) vs Clerk.
3. **Durable runtime** — Inngest (mature DX) vs Vercel Workflow (all-Vercel, newer).
4. **Crawling** — managed (Firecrawl) vs self-driven (Sandbox/Browserless); depends on target sites'
   JS/bot protection and ToS.
5. **Geography scope** — confirm single metro for v1.
6. **Locale** — assuming VND + m². Confirm.
7. **Single vs multi-tenant** — assuming a small private/trusted user set; affects auth + PII model.

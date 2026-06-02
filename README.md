# Dwelling Fee — Housing Price Intelligence System

Collects fragmented housing price signals (broker messages, web posts) and turns them into
structured, queryable market intelligence to support a buying decision. See
[`docs/design.md`](docs/design.md) for the full product & architecture design.

> The hard problems are extraction, entity resolution, and statistical honesty — not the CRUD.
> Read `docs/design.md` §0 first.

## Stack

Next.js (App Router) on Vercel · Neon Postgres (PostGIS + pgvector) · Drizzle ORM ·
**Vercel AI SDK** with pluggable providers (Anthropic / OpenAI / Gemini) · durable jobs
(Inngest/WDK) in Phase 3.

## Layout

```
docs/              design docs (design.md is the source of truth)
phase0/            extraction eval harness — the de-risking gate (see phase0/README.md)
lib/ai/            multi-provider LLM registry (provider/model chosen via env)
lib/extraction/    the shared extractor (prompt + zod schema) used by app AND harness
lib/ingest/        conversational ingest: session + chat agent + draft → commit (+ provenance);
                   also a one-shot ingestSignal() for programmatic/agent use
lib/resolution.ts  deterministic entity resolution (blocking + scoring + decision bands)
lib/review.ts      review-queue service (HITL link/create/dismiss)
lib/{properties,analytics,stats,text}.ts   property pages, segmented stats, helpers
db/                Drizzle schema (§6), client, extensions.sql
app/               Next.js app: Ingest · Review · Properties · Analytics + API routes
```

## Setup

```bash
npm install
cp .env.example .env            # fill in DATABASE_URL + ANTHROPIC_API_KEY

# one-time, against your Neon branch:
psql "$DATABASE_URL" -f db/extensions.sql   # enable postgis + vector
npm run db:push                              # create tables from the Drizzle schema

npm run dev                      # http://localhost:3000 — paste a broker message
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js app |
| `npm run phase0:eval` | Score extraction accuracy against the golden set (needs `ANTHROPIC_API_KEY`) |
| `npm run db:push` | Sync Drizzle schema to the database |
| `npm run db:generate` / `db:migrate` | Versioned migrations |
| `npm run typecheck` | `tsc --noEmit` |

## Status

- **Phase 0** — extraction eval harness ✅ (run it; replace synthetic data with real messages)
- **Phase 1** — conversational ingest + entities ✅: an **ingest session** (chatbot) drafts
  structured records from pasted messages and refines them through conversation, then commits →
  deterministic entity resolution (auto-link / create / queue) → HITL review queue → property
  living pages with scatter + IQR distribution → segmented analytics (asking ≠ transacted,
  sample-size guards). Committed observations carry session + raw-signal provenance.
- **Phase 2** — geocoding + map/heatmap, OCR for screenshots. Not started.
- **Phase 3** — collection agent (durable crawl) + embeddings-based resolution. Not started.
- **Phase 4** — broker outreach + valuation alerts. Not started.

Known Phase-1 simplifications (by design, see docs/design.md): resolution is deterministic
(no embeddings yet); analytics segments by listing/deal type, not yet by location (geocoding
is Phase 2); "dismiss" leaves an orphan observation rather than deleting (append-only).

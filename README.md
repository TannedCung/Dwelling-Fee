# Dwelling Fee — Housing Price Intelligence System

Collects fragmented housing price signals (broker messages, web posts) and turns them into
structured, queryable market intelligence to support a buying decision. See
[`docs/design.md`](docs/design.md) for the full product & architecture design.

> The hard problems are extraction, entity resolution, and statistical honesty — not the CRUD.
> Read `docs/design.md` §0 first.

## Stack

Next.js (App Router) on Vercel · Neon Postgres (PostGIS + pgvector) · Drizzle ORM ·
Claude (Haiku for extraction) · durable jobs (Inngest/WDK) in Phase 3.

## Layout

```
docs/              design docs (design.md is the source of truth)
phase0/            extraction eval harness — the de-risking gate (see phase0/README.md)
lib/extraction/    the shared extractor (prompt + schema) used by app AND harness
lib/ingest.ts      Phase 1 ingest flow: store raw_signal → extract → persist observations
db/                Drizzle schema (§6), client, extensions.sql
app/               Next.js app: paste-to-ingest UI + /api/ingest route
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
- **Phase 1** — manual ingest + entities: paste→extract→store ✅ skeleton; entity resolution &
  review queue are next (design §5).
- **Phases 2–4** — analytics/viz, collection agent, outreach. Not started.

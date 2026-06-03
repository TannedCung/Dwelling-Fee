# Codex Rules For This Repo

## Project Shape

- This is a Next.js 15 App Router TypeScript app for housing price intelligence.
- `docs/design.md` is the product and architecture source of truth. Read its problem statement before changing extraction, entity resolution, analytics, collection, or DB behavior.
- Core stack: React 19, Drizzle ORM, Neon Postgres with PostGIS/pgvector, Auth.js/NextAuth v5, Vercel AI SDK, Node test runner, Playwright.
- Keep work scoped. Do not churn generated artifacts such as `.next/`, `tsconfig.tsbuildinfo`, `test-results/`, or migration files unless the task explicitly needs them.

## Domain Invariants

- Preserve provenance. `raw_signal.raw_text` is immutable source text; committed observations must retain links to `raw_signal` and, when applicable, `ingest_session`.
- Preserve append-only facts. Do not overwrite or delete price observations as a way to correct reality; corrections should happen through review, entity links, or auditable merge behavior.
- Store money as integer VND. Avoid floats for currency; convert Drizzle `numeric` fields to strings on writes and numbers only at presentation/stat boundaries.
- Do not mix analytical segments. Asking, transacted, sale, rent, and review-pending observations must remain separate unless a user explicitly asks for a combined exploratory view with caveats.
- Use median/IQR and sample-size guards for noisy price distributions. Keep `MIN_SAMPLE` behavior visible when adding analytics.
- Ambiguous extraction or entity matches go to human review. Do not silently auto-link or create records by weakening thresholds without tests and a design reason.
- Scraping, broker outreach, auth, phone numbers, and source metadata can carry ToS/PII risk. Keep collection idempotent and avoid exposing sensitive fields unnecessarily.

## Implementation Patterns

- Route handlers should use `route()` and `parseBody()` from `lib/api/respond.ts` for consistent error shape and logging.
- DB code should use `getDb()` for short single-statement reads and `transaction()` for dependent writes. Do not hold a DB transaction open across LLM calls, network crawls, or other slow external work.
- Runtime-sensitive routes/pages that touch Neon, PostGIS, pgvector, Node crypto, or provider SDKs should declare `runtime = "nodejs"` and usually `dynamic = "force-dynamic"`.
- Shared business logic belongs under `lib/`; UI pages should stay thin and call library services.
- Extraction surfaces are `lib/extraction/schema.ts` and `lib/extraction/extract.ts`. Any schema/prompt change should keep the phase0 harness and app ingest aligned.
- Provider/model selection belongs in `lib/ai/registry.ts`; do not hard-code model IDs in feature code.
- Entity resolution starts in `lib/resolution.ts` with deterministic blocking, weighted scoring, and decision bands. Embeddings should not be introduced without labeled examples or tests.
- Conversational ingest commits through `lib/ingest/commit.ts`; one-shot ingest uses `lib/ingest/index.ts`. Both share `persistDraft()`.
- Auth is Google allowlist based. Empty `AUTH_ALLOWED_EMAILS` means closed access.

## Frontend Rules

- Follow the existing app shell and warm design system in `app/globals.css`; reuse classes such as `page-head`, `section`, `card`, `card-grid`, `btn`, `badge`, `chip`, `notice`, `empty`, `mono`, and `table-wrap`.
- Prefer server components for data loading and small client components only for interaction, transitions, toasts, fetch calls, and router refreshes.
- Reuse `app/_components/icon.tsx` for icons. Add paths there only when needed and keep the inline Lucide style consistent.
- Keep operational screens dense and scannable. Do not add marketing-style landing sections for app workflows.
- Use existing database error handling patterns: catch page-level DB failures, pass them through `describeError()`, and render `DatabaseError`.

## Tests And Commands

- Install dependencies with `npm install`.
- Primary checks:
  - `npm run typecheck`
  - `npm run test:unit`
  - `npm run build`
- E2E checks:
  - `npm run test:e2e`
  - `npm run test:e2e:ui`
- Extraction evaluation:
  - `npm run phase0:eval`
  - `npm run phase0:extract -- "<broker message>"`
- DB commands:
  - `npm run db:push` for local/schema sync
  - `npm run db:generate` and `npm run db:migrate` for versioned migrations
- Many commands require `.env` values. Use `MOCK_AI=1` for tests that should avoid provider calls when supported.

## Change Discipline

- Add or update focused unit tests when changing extraction completeness, price derivation, stats, resolution scoring, persistence, or other shared logic.
- Never add mock tests. Prefer real behavior tests with deterministic fixtures, local fakes only when needed at the boundary, and existing `MOCK_AI=1` support for avoiding provider calls.
- Use Playwright when changing authenticated workflows, ingest chat, review actions, collection pages, or layout behavior that unit tests cannot cover.
- Do not commit secrets, `.env`, `.vercel/`, auth state, reports, or build output.
- Before finishing, report which checks ran and any environment-limited checks that could not run.

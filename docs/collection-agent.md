# Edge Collection Agent

Last updated: 2026-06-24.

Dwelling Fee collects public listing posts through trusted edge devices. The
Next.js/Vercel app does not fetch source pages. It stores source configuration,
device credentials, crawl jobs, audit events, deduplicated results, and review
state. Edge workers run browser automation on local machines and submit extracted
listing text through signed APIs.

The product invariant is unchanged: collected posts become immutable
`raw_signal` rows first. Extraction, resolution, review, and analytics continue
to consume that provenance-preserving artifact.

## Goals

- Collect public, non-personal listing data such as prices, addresses, unit
  attributes, and listing text from registered sources.
- Keep collection resilient for JavaScript-heavy sites by running Playwright on
  edge devices instead of serverless infrastructure.
- Support human verification without bypassing access challenges: the worker can
  expose a private noVNC browser URL and wait for a person to solve the page in
  the worker browser profile.
- Deduplicate before review, then distill collected post text so the extractor
  receives compact listing facts rather than raw page noise.

## Architecture

```txt
/collect
  -> collection_source config
  -> crawl_job queue
  -> signed edge worker lease
  -> Playwright browser on edge device
  -> crawl_result_page / crawl_result_item audit rows
  -> raw_signal dedup by source_type + source_ref
  -> distillEdgePost()
  -> ingestSignal()
  -> extraction / resolution / review
```

The app exposes these operational surfaces under `/collect`:

- Source registry and source enable/disable state.
- One-click queueing for edge crawl jobs.
- Edge device registration and revocation.
- Recent queue status, result counts, duplicate counts, and observation counts.
- Verification notices with private remote browser links when a worker reports
  `needs_user_action`.
- Edge event history for audits and debugging.

## Server Responsibilities

- Validate and store source configuration.
- Register devices with one-time secrets.
- Authenticate worker requests using HMAC signatures, timestamp checks, and nonce
  replay protection.
- Lease queued jobs only to active, scoped devices.
- Enforce source-domain allowlists on submitted page URLs and source references.
- Persist page and item audit rows submitted by workers.
- Skip duplicate `raw_signal` source references before adding review work.
- Distill non-duplicate post text with `distillEdgePost()` before ingestion.
- Ingest distilled text through the same append-only `ingestSignal()` path used by
  broker messages.

The server must not run source-page fetches, Playwright crawls, CAPTCHA solving,
or long-lived browser sessions.

## Edge Worker Responsibilities

- Poll for jobs from the app and maintain heartbeats while running.
- Use a persistent Chromium profile for source cookies and normal browser state.
- Collect listing pages with Playwright and the shared DOM extraction helpers in
  `lib/collection/http-fetcher.ts`.
- Submit only bounded page metadata and extracted post text. Do not submit
  cookies, localStorage, auth headers, screenshots, or full HTML.
- Report `needs_user_action` when the browser reaches an access challenge or
  CAPTCHA, then wait for a human to solve it in the edge browser.
- Fail zero-post crawls by default so empty runs do not silently enter review as
  successful collections.

## Human Verification

Verification remains human-in-the-loop. The worker can be started with a private
noVNC browser appliance over Tailscale or another secure tunnel. When a challenge
appears, `/collect` shows an **Open remote browser** action. The user solves the
challenge in the edge device's Chromium profile, and the worker resumes once
listing content is visible.

This is not CAPTCHA bypass automation. The system does not solve challenges
programmatically or send challenge content to third-party bypass services.

## Data Model

Active edge collection uses:

- `collection_source`: source URL, enabled state, and edge crawl config.
- `edge_device`: registered worker identity and revocation state.
- `crawl_job`: queue, lease, status, counters, and current action state.
- `edge_device_event`: audit timeline.
- `crawl_result_page`: per-job page metadata submitted by workers.
- `crawl_result_item`: submitted extracted post text and ingest linkage.
- `raw_signal`: immutable source text and dedup boundary.

`collection_run` and `collection_page` are legacy tables from the earlier
server-side crawler. They remain in schema for existing deployments but are not
used by new collection code.

## Source Configuration

Source config is intentionally small and worker-oriented:

- `maxPages`, `maxDepth`, `followLinks`: crawl scope.
- `allowedDomains`, `includeUrlPatterns`, `excludeUrlPatterns`: source boundary.
- `contentSelector`, `itemSelector`, `linkSelector`: extraction hints.
- `maxTextChars`: text bound per extracted item.
- `minItems`: minimum extracted posts required for success.
- `solveTimeoutMs`: human verification wait window.

Server-only crawl controls such as Vercel cron, manual server run, server HTTP
preview, server concurrency, server sitemaps, and server page-cache writes are
not part of the current collection model.

## Zalo Outreach

Zalo outreach remains separate from edge listing collection. If implemented, it
should run as its own opt-in bridge with human approval before sending messages.
Inbound broker replies should enter the same `raw_signal` path, but outreach
credentials and long-lived sessions should not be embedded in the Next.js app.

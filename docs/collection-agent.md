# Collection Agent And Zalo Outreach

Research date: 2026-06-03.

This note turns the Phase 3/4 collection-agent idea in `docs/design.md` into an
implementation path. The key product rule is unchanged: crawled pages and broker
replies become immutable `raw_signal` rows first; extraction, resolution, review,
and analytics continue to consume the same provenance-preserving artifact.

## Goals

- Crawl public listing sources such as Batdongsan and ingest new listing text
  through the existing one-shot `ingestSignal()` path.
- Detect missing/uncertain facts and draft follow-up questions for sales/brokers.
- Start with Zalo for buyer-side data collection from sales contacts, but require
  human approval before sending.
- Preserve append-only facts: broker replies can add new observations or review
  evidence, not overwrite prior observations.

## Current Repo State

The repo already has a Phase 3 collection scaffold:

- `collection_source` and `collection_run` tables track sources and run history.
- `lib/collection/run.ts` calls a source fetcher and sends each item to
  `ingestSignal()`.
- `lib/collection/fetchers.ts` has a guarded `http` fetcher.
- `lib/collection/internet-search.ts` provides a provider-backed internet
  search utility for project/building research context. Agent workflows should
  consume it through `projectInformationSearch`; every result is marked
  `Tier 2` / unconfirmed.
- `/collect` lets an authenticated user add sources, run them, and inspect recent
  run counts.

That is the right seam for the crawler. Zalo outreach should not bypass it; the
bot's job is to ask sales contacts for price and property facts, and each reply
should enter the system as a broker-originated raw signal.

## Research Findings

### Batdongsan Crawling

`https://batdongsan.com.vn/robots.txt` currently allows general crawling and
disallows only a small set of router/handler paths, with public sitemaps exposed.
This is only a crawl hint, not legal permission. The app should still keep
source-level controls:

- Explicit allowlist of domains and URL patterns.
- Respect `robots.txt` at run time.
- Low request rate, descriptive user agent, no login bypass, no CAPTCHA bypass,
  no anti-bot circumvention.
- Store page URL, captured time, content hash, and extracted visible text.
- Treat broker names, phone numbers, and Zalo IDs as PII at the source boundary.

### Zalo Options

There are two practical Zalo paths, but they do not fit this product equally.

1. Official Zalo Official Account (OA) API.

   Zalo Developers positions OA as the official business API for two-way user
   interaction. Third-party integration docs for OA describe webhook delivery,
   HMAC-SHA256 verification with the OA secret, OA access tokens for replies, and
   duplicate event suppression.

   Fit for this product: low. This bot is not an OA for selling houses or
   servicing customers. It is acting on behalf of a buyer/researcher to collect
   housing prices and missing listing details from sales contacts. Brokers are
   likely to expect a normal Zalo contact flow, not an Official Account. OA can
   still be useful later if the workflow is explicitly opt-in or if Zalo policy
   requires an official business surface, but it should not be the default MVP.

2. Free unofficial personal-account automation.

   `RFS-ADRENO/zca-js` is an unofficial TypeScript/JavaScript client for personal
   Zalo accounts. Its README says it simulates Zalo Web, supports QR login,
   listening for messages, and sending messages. It also warns that use can lock
   or ban the account. GitHub currently shows version `v2.1.2` as the latest
   release, dated 2026-03-17. It is MIT-licensed and is the preferred free
   implementation base for the MVP bridge.

   `zca-cli` is a commercial CLI/server wrapper around this automation style. Its
   docs describe QR login, persisted profiles, send commands, a real-time
   listener with webhook forwarding, keep-alive, raw JSON output, multi-account
   support, and a local REST API server. It also states it is not affiliated with
   Zalo or VNG. Because it is commercial, do not use it for this project unless
   the project later explicitly accepts paid tooling.

## Recommendation

For this buyer-side collection workflow, build the first Zalo MVP as a free,
opt-in personal-account bridge operated by the user. Use a small self-hosted
worker built on `zca-js`; do not use `zca-cli` for the MVP because it is
commercial. This is not an OA sales/support channel and should not run inside the
Next.js/Vercel app. Keep official OA support as a later adapter only if it proves
acceptable for broker conversations.

Do not import `zca-js` directly into the web app. A personal-account listener is a
long-running WebSocket/session process with local credentials and QR login state;
that does not fit serverless route handlers and expands the blast radius if the
account is restricted. Keep it in a separate worker process that calls this app
over authenticated HTTP.

The free bridge should provide only a narrow surface:

- QR-login/session bootstrap on the worker host.
- Listen for direct messages from approved threads.
- Send approved text messages to one thread at a time.
- Forward normalized inbound events to the app webhook.
- Persist only the minimum local Zalo session state required to reconnect.

## Proposed Architecture

```
Crawler source
  -> source fetcher
  -> CollectedItem { sourceRef, text, capturedAt }
  -> ingestSignal({ sourceType: "web" | "agent" })
  -> extraction / resolution / review

Missing-data detector
  -> outreach task
  -> LLM draft question for sale/broker
  -> human approval
  -> Zalo bridge sends message

Zalo reply
  -> bridge webhook to app
  -> raw_signal(source_type = "broker", source_ref = "zalo:<profile>:<thread>:<message>")
  -> extraction / resolution / review
```

The bridge should be stateless from the app's perspective. It owns Zalo login
state and exposes only normalized events:

```ts
type ZaloInboundEvent = {
  provider: "zalo";
  mode: "oa" | "personal";
  profile: string;
  threadId: string;
  messageId: string;
  senderId: string;
  senderName?: string;
  text?: string;
  attachments?: Array<{ type: string; url?: string; name?: string }>;
  sentAt?: string;
};
```

App-side security requirements:

- Dedicated shared secret or signed webhook for the bridge.
- Idempotency by provider/profile/thread/message.
- Allowlist of sender IDs or manually approved outreach threads.
- No automatic first-contact sending.
- No deceptive identity claims; the bot should represent the user's buying or
  research intent plainly.
- Full outbound audit log: draft, approver, approved time, sent time, provider
  response, failure reason.

## Data Model Additions

Add these only when implementing outreach, not for the crawler-only milestone:

- `outreach_thread`: channel, external thread ID, broker contact, listing/source
  context, status, last inbound/outbound timestamps.
- `outreach_message`: append-only inbound/outbound messages, normalized text,
  attachments, provider message ID, raw provider payload, approval metadata.
- `outreach_task`: missing fields, draft prompt, draft message, approval status,
  reviewer, sent status, retry/error fields.

`broker_contact` should be linked from outreach threads, but phone/Zalo IDs should
remain restricted PII. If encryption-at-rest is added later, this is one of the
first tables that needs it.

## Implementation Milestones

1. Real crawler fetcher.
   `http` fetcher behind `lib/collection/fetchers.ts` uses robots checks,
   source-domain allowlisting, per-source rate limits, visible-text extraction,
   stable `sourceRef`, page-cache metadata, and deterministic tests using local
   fixture HTML. Do not add scraping bypass behavior.

2. Collection quality gates.
   Add source config validation, max pages/depth/concurrency controls,
   selector-based extraction, dry-run preview, and failure reasons visible on
   `/collect`.

3. Outreach queue without sending.
   Add missing-field detection over extracted/review-pending observations and
   create human-reviewable outreach tasks. The LLM may draft concise buyer-side
   questions for sales contacts, but the UI must require approval.

4. Zalo bridge webhook.
   Add an app route that accepts normalized inbound events from an external Zalo
   bridge, validates signatures, deduplicates events, creates/links broker
   contacts, and inserts immutable `raw_signal` rows.

5. Zalo outbound bridge.
   Add a sender adapter that posts approved outbound tasks to a local
   personal-account bridge first. Keep a hard kill switch in env and per
   source/channel.

6. Conversation-to-ingest loop.
   Feed broker replies through existing extraction and review. If a reply is a
   correction, append a new observation or review note; do not mutate previous
   observations.

## Open Decisions

- Whether the `zca-js` worker should live as a separate package in this repo or as
  a separate deployment repo.
- Whether broker replies should create conversational ingest sessions or go
  directly through one-shot `ingestSignal()`. One-shot is simpler; sessions give a
  better provenance story for multi-turn clarification.
- What fields trigger outreach. Start with price, area, project/name, listing
  type, legal status, and observed date.
- How much broker identity to store before encryption/access-control work is
  complete.

## Sources

- Zalo Developers: https://developers.zalo.me/
- `RFS-ADRENO/zca-js`: https://github.com/RFS-ADRENO/zca-js
- `zca-js` docs: https://zca-js.tdung.com/
- `zca-cli` docs: https://zca-cli.dev/docs
- ClawCentral Zalo OA notes: https://docs.clawcentral.io/channels/zalo/
- Batdongsan robots file checked on 2026-06-03:
  https://batdongsan.com.vn/robots.txt

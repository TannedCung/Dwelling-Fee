# LLM Wiki Grounding

Dwelling Fee uses a Postgres-backed LLM wiki as the durable memory layer for entity identity. It is the alternative to reaching for a vector database first: the system stores compact, structured, source-backed facts on canonical entities, then retrieves those facts during extraction review and entity resolution.

## Non-Negotiable Rule

Never hardcode project-, venue-, person-, or case-specific facts to solve a single issue. If the system needs to know that two names refer to the same project, that fact must come from grounded wiki data, review evidence, or a source-backed enrichment step. Code operates on the structure generically.

## Current Storage

The `property` table is the wiki page for real-estate entities:

- `name`, `project_name`, `building_name`, `house_number`: canonical identity hierarchy.
- `aliases`: grounded alternative names, abbreviations, marketing names, and known local spellings.
- `tags`: reusable descriptors for properties and observations, not alternate identities by themselves.
- `wiki_notes`: compact source-backed notes that explain identity, hierarchy, and evidence.
- `ai_summary`: generated narrative summary for the page after enough evidence exists.

`raw_signal` and `price_observation` remain the immutable evidence trail. Wiki fields summarize and organize evidence; they do not replace provenance.

## Wiki Note Shape

Use a compact text page format so LLMs can read it reliably without embeddings:

```text
## Identity
Canonical: <entity name>
Aliases: <alias 1>; <alias 2>
Granularity: project | building | unit | house | land

## Hierarchy
Project: <project name>
Buildings/blocks: <known buildings, phases, or rules>
Observation-level details: <fields that should stay on observations, such as unit labels>

## Evidence
- Source: <url or raw signal id>
  Claim: <short factual claim>
  Retrieved: <date>
  Confidence: high | medium | low

## Resolution Notes
<short instructions for future matching, written generically>
```

## Grounding Loop

1. Extract structured candidate observations from user text, screenshots, or crawled pages.
2. Generate blocking tokens from project, building, unit, aliases, and location text.
3. Retrieve candidate wiki pages from Postgres by normalized hierarchy fields, aliases, tags, and `wiki_notes`.
4. Resolve against the grounded page. For a project-level candidate, tower and unit labels can remain observation-level details.
5. If an apartment observation has `project_name` plus `building_name` or `house_number` but no grounded parent candidate, send it to review instead of creating a new unit-level property.
6. Review or enrichment updates the wiki page with aliases, hierarchy notes, and evidence.
7. Retry or commit the observation once the grounded parent exists.

## Resolution Rules

- A generic unit label such as `Căn 1` or `Unit 1201` is not a property identity by itself.
- Marketing names, abbreviations, and local spellings become identity signals only after being stored in `aliases` or explained in `wiki_notes`.
- Tags such as `signature`, `elite`, `riverfront`, or `corner` are reusable descriptors. They can help search and review, but they must not force an identity match alone.
- New code must not add constants for real projects. Add generic matching behavior, wiki retrieval, or review gates instead.
- Ambiguous matches stay in review. Missing grounding is not permission to create a new property for every observation.

## Future Schema

The current implementation intentionally keeps the wiki in `property` fields. If evidence volume grows, add normalized tables without changing the loop:

```sql
entity_alias(entity_type, entity_id, alias, normalized_alias, source_id, confidence)
wiki_evidence(entity_type, entity_id, source_url, raw_signal_id, claim, retrieved_at, confidence)
entity_relationship(parent_type, parent_id, child_type, child_id, relation, evidence_id)
```

Only add these tables when the existing `aliases` and `wiki_notes` fields become hard to audit.

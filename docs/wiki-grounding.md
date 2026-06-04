# LLM Wiki Grounding

Dwelling Fee uses a Postgres-backed LLM wiki as the durable memory layer for entity identity. It is the alternative to reaching for a vector database first: the system stores compact, structured, source-backed facts on canonical entities, then retrieves those facts during extraction review and entity resolution.

## Non-Negotiable Rule

Never hardcode project-, venue-, person-, or case-specific facts to solve a single issue. If the system needs to know that two names refer to the same project, that fact must come from grounded wiki data, review evidence, or a source-backed enrichment step. Code operates on the structure generically.

## Current Storage

Projects, buildings, and properties are separate wiki entities:

- `project`: root development/place entity with aliases, tags, wiki notes, and source-backed summary.
- `building`: tower/block/phase entity under one project.
- `property`: the most specific known unit, house, or lot; observations link here once resolved.
- `property.project_id` and `property.building_id`: normalized hierarchy links.
- `property.project_name` and `property.building_name`: transitional compatibility mirrors retained for older rows and queries.
- `aliases`, `tags`, `wiki_notes`, `ai_summary`: grounded memory fields on each entity level.

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
4. Resolve the hierarchy in order: project, then building, then property.
5. For apartments, project/building alone is not a property identity. Keep the observation in review unless a specific unit/lot/house is identified or a reviewer explicitly decides how to attach it.
6. If an apartment observation has project/building/unit details but no grounded parent entity, send it to review instead of creating an orphan property.
7. Review or enrichment updates the correct wiki page with aliases, hierarchy notes, and evidence.
8. Retry or commit the observation once the grounded parent exists.

## Resolution Rules

- A generic unit label such as `Căn 1` or `Unit 1201` is not a property identity by itself.
- A project or building name is not an apartment property identity by itself.
- Marketing names, abbreviations, and local spellings become identity signals only after being stored in `aliases` or explained in `wiki_notes`.
- Tags such as `signature`, `elite`, `riverfront`, or `corner` are reusable descriptors. They can help search and review, but they must not force an identity match alone.
- New code must not add constants for real projects. Add generic matching behavior, wiki retrieval, or review gates instead.
- Ambiguous matches stay in review. Missing grounding is not permission to create a new property for every observation.

## Possible Future Schema

The current implementation keeps aliases and evidence as compact fields on each entity. If evidence volume grows, add normalized support tables without changing the loop:

```sql
entity_alias(entity_type, entity_id, alias, normalized_alias, source_id, confidence)
wiki_evidence(entity_type, entity_id, source_url, raw_signal_id, claim, retrieved_at, confidence)
entity_relationship(parent_type, parent_id, child_type, child_id, relation, evidence_id)
```

Only add these tables when the existing `aliases` and `wiki_notes` fields become hard to audit.

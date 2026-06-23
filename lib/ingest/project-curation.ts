import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { building, project } from "../../db/schema";
import { getDb, type DbExecutor } from "../../db/client";
import {
  INTERNET_SEARCH_CAVEAT,
  INTERNET_SEARCH_EVIDENCE_TIER,
} from "../collection/internet-search";
import { normalizeName, uniqueText } from "../text";

export interface Tier2Evidence {
  title: string;
  url: string;
  snippet: string;
  source: string;
  tier: typeof INTERNET_SEARCH_EVIDENCE_TIER;
}

export const ProjectCurationDraftSchema = z.object({
  projectName: z.string().nullable().describe("Canonical project/development name. Required to write project info."),
  buildingName: z.string().nullable().describe("Building/tower/block name when the evidence is building-specific."),
  aliases: z.array(z.string()).describe("Observed project/building aliases from the broker text or search evidence."),
  tags: z.array(z.string()).describe("Non-price project/building tags such as apartment, tower, compound, developer, amenity, or phase."),
  addressText: z.string().nullable().describe("Project/building location text only when supported by evidence."),
  wikiNotes: z.string().nullable().describe("Short same-language project/building information summary. No sale/rent listing facts."),
  facts: z.array(z.object({
    key: z.string().describe("Stable snake_case fact name, e.g. developer, tower_count, amenities, location_context."),
    value: z.string().describe("Short fact value supported by Tier 2 evidence."),
    appliesTo: z.enum(["project", "building"]),
  })).describe("Curated non-price project/building facts supported by Tier 2 evidence."),
  evidence: z.array(z.object({
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
    source: z.string(),
    tier: z.literal(INTERNET_SEARCH_EVIDENCE_TIER),
  })).describe("Tier 2 source snippets used for this curation draft."),
  searchQuery: z.string().nullable().describe("The research query used to gather this Tier 2 evidence."),
  model: z.string().describe("The agent/model that curated this draft."),
});

export type ProjectCurationDraft = z.infer<typeof ProjectCurationDraftSchema>;

export interface ProjectCurationResult {
  projectsUpserted: number;
  buildingsUpserted: number;
}

export async function commitProjectCuration(
  drafts: ProjectCurationDraft[],
  db: DbExecutor = getDb(),
): Promise<ProjectCurationResult> {
  let projectsUpserted = 0;
  let buildingsUpserted = 0;

  for (const draft of drafts) {
    const projectId = await upsertProjectTier2(draft, db);
    if (projectId) projectsUpserted++;
    if (projectId && draft.buildingName) {
      const buildingId = await upsertBuildingTier2(projectId, draft, db);
      if (buildingId) buildingsUpserted++;
    }
  }

  return { projectsUpserted, buildingsUpserted };
}

async function upsertProjectTier2(draft: ProjectCurationDraft, db: DbExecutor): Promise<string | null> {
  const name = draft.projectName?.trim();
  const normalized = normalizeName(name ?? "");
  if (!name || !normalized) return null;

  const tier2 = tier2Record(draft, "project");
  const existing = await db.query.project.findFirst({
    columns: {
      id: true,
      aliases: true,
      tags: true,
      addressText: true,
      attributes: true,
      wikiNotes: true,
    },
    where: and(isNull(project.canonicalProjectId), eq(project.nameNormalized, normalized)),
  });

  if (existing) {
    await db
      .update(project)
      .set({
        aliases: mergeJsonText(existing.aliases, draft.aliases),
        tags: mergeJsonText(existing.tags, draft.tags),
        addressText: existing.addressText ?? draft.addressText,
        attributes: mergeTier2Attributes(existing.attributes, tier2),
        wikiNotes: mergeTier2WikiNotes(existing.wikiNotes, draft.wikiNotes),
        updatedAt: new Date(),
      })
      .where(eq(project.id, existing.id));
    return existing.id;
  }

  const inserted = await db
    .insert(project)
    .values({
      name,
      nameNormalized: normalized,
      aliases: draft.aliases.length > 0 ? draft.aliases : null,
      tags: draft.tags.length > 0 ? draft.tags : null,
      addressText: draft.addressText,
      attributes: mergeTier2Attributes(null, tier2),
      wikiNotes: mergeTier2WikiNotes(null, draft.wikiNotes),
    })
    .onConflictDoNothing({ target: project.nameNormalized })
    .returning({ id: project.id });
  if (inserted[0]) return inserted[0].id;

  const raced = await db.query.project.findFirst({
    columns: { id: true },
    where: and(isNull(project.canonicalProjectId), eq(project.nameNormalized, normalized)),
  });
  return raced?.id ?? null;
}

async function upsertBuildingTier2(projectId: string, draft: ProjectCurationDraft, db: DbExecutor): Promise<string | null> {
  const name = draft.buildingName?.trim();
  const normalized = normalizeName(name ?? "");
  if (!name || !normalized) return null;

  const tier2 = tier2Record(draft, "building");
  const existing = await db.query.building.findFirst({
    columns: {
      id: true,
      aliases: true,
      tags: true,
      addressText: true,
      attributes: true,
      wikiNotes: true,
    },
    where: and(isNull(building.canonicalBuildingId), eq(building.projectId, projectId), eq(building.nameNormalized, normalized)),
  });

  if (existing) {
    await db
      .update(building)
      .set({
        aliases: mergeJsonText(existing.aliases, draft.aliases),
        tags: mergeJsonText(existing.tags, draft.tags),
        addressText: existing.addressText ?? draft.addressText,
        attributes: mergeTier2Attributes(existing.attributes, tier2),
        wikiNotes: mergeTier2WikiNotes(existing.wikiNotes, draft.wikiNotes),
        updatedAt: new Date(),
      })
      .where(eq(building.id, existing.id));
    return existing.id;
  }

  const inserted = await db
    .insert(building)
    .values({
      projectId,
      name,
      nameNormalized: normalized,
      aliases: draft.aliases.length > 0 ? draft.aliases : null,
      tags: draft.tags.length > 0 ? draft.tags : null,
      addressText: draft.addressText,
      attributes: mergeTier2Attributes(null, tier2),
      wikiNotes: mergeTier2WikiNotes(null, draft.wikiNotes),
    })
    .onConflictDoNothing({ target: [building.projectId, building.nameNormalized] })
    .returning({ id: building.id });
  if (inserted[0]) return inserted[0].id;

  const raced = await db.query.building.findFirst({
    columns: { id: true },
    where: and(isNull(building.canonicalBuildingId), eq(building.projectId, projectId), eq(building.nameNormalized, normalized)),
  });
  return raced?.id ?? null;
}

function tier2Record(draft: ProjectCurationDraft, appliesTo: "project" | "building") {
  return {
    tier: INTERNET_SEARCH_EVIDENCE_TIER,
    caveat: INTERNET_SEARCH_CAVEAT,
    curatedAt: new Date().toISOString(),
    model: draft.model,
    searchQuery: draft.searchQuery,
    projectName: draft.projectName,
    buildingName: draft.buildingName,
    appliesTo,
    facts: draft.facts.filter((fact) => fact.appliesTo === appliesTo),
    evidence: draft.evidence.slice(0, 5),
  };
}

export function mergeTier2Attributes(existing: unknown, record: unknown): Record<string, unknown> {
  const base = plainObject(existing) ? { ...existing } : {};
  const previous = Array.isArray(base.tier2Research) ? base.tier2Research : [];
  const key = tier2Key(record);
  const withoutDuplicate = previous.filter((item) => tier2Key(item) !== key);
  return {
    ...base,
    tier2Research: [...withoutDuplicate, record].slice(-10),
  };
}

export function mergeTier2WikiNotes(existing: string | null, note: string | null): string | null {
  const clean = note?.trim();
  if (!clean) return existing;
  const entry = `[Tier 2 unconfirmed] ${clean}`;
  if (!existing?.trim()) return entry;
  if (existing.includes(entry) || existing.includes(clean)) return existing;
  return `${existing.trim()}\n\n${entry}`;
}

function mergeJsonText(existing: unknown, incoming: string[]): string[] | null {
  const current = Array.isArray(existing) ? existing.filter((v): v is string => typeof v === "string") : [];
  const merged = uniqueText([...current, ...incoming]);
  return merged.length > 0 ? merged : null;
}

function tier2Key(value: unknown): string {
  if (!plainObject(value)) return "";
  const urls = Array.isArray(value.evidence)
    ? value.evidence
        .filter((item): item is { url: string } => plainObject(item) && typeof item.url === "string")
        .map((item) => item.url)
        .sort()
        .join("|")
    : "";
  return [
    typeof value.projectName === "string" ? normalizeName(value.projectName) : "",
    typeof value.buildingName === "string" ? normalizeName(value.buildingName) : "",
    typeof value.appliesTo === "string" ? value.appliesTo : "",
    urls,
  ].join("::");
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

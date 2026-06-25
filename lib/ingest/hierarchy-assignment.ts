import { getDb, type DbExecutor } from "../../db/client";
import { INTERNET_SEARCH_EVIDENCE_TIER, searchInternetForProjectInformation, type InternetSearchOutput, type InternetSearchResult } from "../collection/internet-search";
import type { PropertyExtraction } from "../extraction/schema";
import { cleanProjectName } from "../resolution";
import { jaccard, normalizeName, tokens, uniqueText } from "../text";
import { commitProjectCuration, type ProjectCurationDraft } from "./project-curation";
import { searchExistingEntities, type DbGroundingMatch } from "./research";

const POSTPROCESS_MODEL = "deterministic-hierarchy-postprocess";
const EXISTING_MATCH_MIN = 0.72;
const EXISTING_MATCH_MARGIN = 0.12;
const INTERNET_EVIDENCE_MIN = 2;

export interface HierarchyAssignmentResult {
  properties: PropertyExtraction[];
  projectCuration: ProjectCurationDraft[];
}

interface HierarchyAssignmentDeps {
  searchDb?: (query: string, db: DbExecutor) => Promise<DbGroundingMatch[]>;
  searchInternet?: typeof searchInternetForProjectInformation;
}

interface HierarchyCandidate {
  projectName: string | null;
  buildingName: string | null;
}

export async function postProcessProjectBuildingAssignments(
  properties: PropertyExtraction[],
  db: DbExecutor = getDb(),
  deps: HierarchyAssignmentDeps = {},
): Promise<HierarchyAssignmentResult> {
  const processed: PropertyExtraction[] = [];
  const drafts: ProjectCurationDraft[] = [];
  const searchDb = deps.searchDb ?? searchExistingEntities;
  const searchInternet = deps.searchInternet ?? searchInternetForProjectInformation;

  for (const property of properties) {
    const candidate = initialHierarchyCandidate(property);
    if (!candidate.projectName && !candidate.buildingName) {
      processed.push(property);
      continue;
    }

    const query = hierarchySearchQuery(property, candidate);
    const dbMatches = query ? await searchDb(query, db) : [];
    const existing = chooseExistingHierarchy(property, candidate, dbMatches);
    if (existing) {
      processed.push(applyHierarchy(property, existing, "db"));
      continue;
    }

    if (!candidate.projectName) {
      processed.push(property);
      continue;
    }

    const internet = await searchInternet({
      query: internetSearchQuery(property, candidate),
      purpose: "post-process project/building assignment grounding",
      limit: 5,
    });
    const internetDraft = buildInternetCurationDraft(property, candidate, internet);
    if (internetDraft) {
      drafts.push(internetDraft);
      processed.push(applyHierarchy(property, {
        projectName: internetDraft.projectName,
        buildingName: internetDraft.buildingName,
      }, "internet"));
    } else {
      processed.push(property);
    }
  }

  return { properties: processed, projectCuration: dedupeCurationDrafts(drafts) };
}

export async function commitHierarchyPostProcessCuration(
  drafts: ProjectCurationDraft[],
  db: DbExecutor = getDb(),
) {
  if (drafts.length === 0) return { projectsUpserted: 0, buildingsUpserted: 0 };
  return commitProjectCuration(drafts, db);
}

function initialHierarchyCandidate(property: PropertyExtraction): HierarchyCandidate {
  const inferred = inferHierarchyFromDisplayName(property.name);
  return {
    projectName: reasonableProjectName(property.projectName) ?? inferred.projectName,
    buildingName: reasonableBuildingName(property.buildingName) ?? inferred.buildingName,
  };
}

function inferHierarchyFromDisplayName(name: string | null): HierarchyCandidate {
  const clean = name?.trim();
  if (!clean) return { projectName: null, buildingName: null };
  const parts = clean
    .split(/\s+(?:\/|>|→|--|-)\s+|\s*\/\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return { projectName: null, buildingName: null };
  return {
    projectName: reasonableProjectName(parts[0] ?? null),
    buildingName: reasonableBuildingName(parts[1] ?? null),
  };
}

function chooseExistingHierarchy(
  property: PropertyExtraction,
  candidate: HierarchyCandidate,
  matches: DbGroundingMatch[],
): HierarchyCandidate | null {
  const scored = matches
    .map((match) => ({ match, score: existingHierarchyScore(property, candidate, match) }))
    .filter((item) => item.score >= EXISTING_MATCH_MIN)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;
  const next = scored[1];
  if (next && best.score - next.score < EXISTING_MATCH_MARGIN && !sameExistingHierarchy(best.match, next.match)) return null;

  const projectName = reasonableProjectName(best.match.projectName);
  const buildingName = reasonableBuildingName(best.match.buildingName);
  if (!projectName && !buildingName) return null;
  return { projectName: projectName ?? candidate.projectName, buildingName: buildingName ?? candidate.buildingName };
}

function sameExistingHierarchy(a: DbGroundingMatch, b: DbGroundingMatch): boolean {
  const aProject = normalizeName(a.projectName ?? "");
  const bProject = normalizeName(b.projectName ?? "");
  if (!aProject || aProject !== bProject) return false;
  const aBuilding = normalizeName(a.buildingName ?? "");
  const bBuilding = normalizeName(b.buildingName ?? "");
  return !aBuilding || !bBuilding || aBuilding === bBuilding;
}

function existingHierarchyScore(
  property: PropertyExtraction,
  candidate: HierarchyCandidate,
  match: DbGroundingMatch,
): number {
  const projectScore = maxSimilarity(
    uniqueText([candidate.projectName, property.projectName, cleanProjectName(property.name)]),
    uniqueText([match.projectName, match.name]),
  );
  const buildingScore = maxSimilarity(
    uniqueText([candidate.buildingName, property.buildingName]),
    uniqueText([match.buildingName, match.entityType === "building" ? match.name : null]),
  );

  if (candidate.buildingName) return 0.68 * projectScore + 0.32 * buildingScore;
  return projectScore;
}

function buildInternetCurationDraft(
  property: PropertyExtraction,
  candidate: HierarchyCandidate,
  internet: InternetSearchOutput,
): ProjectCurationDraft | null {
  if (internet.warnings.length > 0) return null;
  const projectName = reasonableProjectName(candidate.projectName);
  if (!projectName) return null;

  const projectEvidence = supportingEvidence(projectName, internet.results);
  if (projectEvidence.length < INTERNET_EVIDENCE_MIN) return null;

  const buildingName = reasonableBuildingName(candidate.buildingName);
  const buildingEvidence = buildingName ? supportingEvidence(buildingName, internet.results) : [];
  const supportedBuildingName = buildingName && buildingEvidence.length >= 1 ? buildingName : null;
  const evidence = uniqueEvidence([...projectEvidence, ...buildingEvidence]).slice(0, 5);

  return {
    projectName,
    buildingName: supportedBuildingName,
    aliases: uniqueText([property.projectName, property.buildingName, property.name, ...property.aliases])
      .filter((alias) => normalizeName(alias) !== normalizeName(projectName))
      .slice(0, 8),
    tags: uniqueText([...property.tags, property.type !== "unknown" ? property.type : null]),
    addressText: property.locationText,
    wikiNotes: `Tier 2 search evidence mentions ${[projectName, supportedBuildingName].filter(Boolean).join(" / ")} as project/building context.`,
    facts: [],
    evidence,
    searchQuery: internet.query,
    model: POSTPROCESS_MODEL,
  };
}

function supportingEvidence(name: string, results: InternetSearchResult[]): InternetSearchResult[] {
  const nameTokens = tokens(normalizeName(name));
  if (nameTokens.length === 0) return [];
  return results.filter((result) => {
    const text = normalizeName([result.title, result.snippet, result.url].join(" "));
    const matched = nameTokens.filter((token) => text.includes(token)).length;
    if (nameTokens.length === 1) return matched === 1;
    return matched / nameTokens.length >= 0.75;
  });
}

function applyHierarchy(
  property: PropertyExtraction,
  hierarchy: HierarchyCandidate,
  source: "db" | "internet",
): PropertyExtraction {
  const projectName = hierarchy.projectName ?? property.projectName;
  const buildingName = hierarchy.buildingName ?? property.buildingName;
  const aliases = uniqueText([
    ...property.aliases,
    source === "db" ? property.projectName : null,
    source === "db" ? property.buildingName : null,
    property.name,
  ]).filter((alias) => normalizeName(alias) !== normalizeName(projectName ?? ""));
  return {
    ...property,
    projectName,
    buildingName,
    name: uniqueText([projectName, buildingName, property.houseNumber]).join(" / ") || property.name,
    aliases,
  };
}

function hierarchySearchQuery(property: PropertyExtraction, candidate: HierarchyCandidate): string | null {
  const parts = uniqueText([
    candidate.projectName,
    candidate.buildingName,
    property.name,
    property.locationText,
  ]);
  return parts.length > 0 ? parts.join(" ") : null;
}

function internetSearchQuery(property: PropertyExtraction, candidate: HierarchyCandidate): string {
  return uniqueText([
    candidate.projectName,
    candidate.buildingName,
    property.locationText,
    "project building official real estate",
  ]).join(" ");
}

function reasonableProjectName(value: string | null | undefined): string | null {
  return reasonableName(cleanProjectName(value), { allowShort: true });
}

function reasonableBuildingName(value: string | null | undefined): string | null {
  return reasonableName(value, { allowShort: true });
}

function reasonableName(value: string | null | undefined, opts: { allowShort: boolean }): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  const normalized = normalizeName(clean);
  if (!normalized) return null;
  if (!opts.allowShort && normalized.length < 3) return null;
  if (clean.length > 80) return null;
  if (/^\d+(?:[.,]\d+)?\s*(?:ty|ti|trieu|tr|m2|m)\b/i.test(normalized)) return null;
  if (/\b(?:ban|can ban|cho thue|gia|price|sale|rent|dien tich|area|phong ngu)\b/i.test(normalized)) return null;
  if (/^(?:can ho|chung cu|apartment|project|du an|toa|tower|block|building)$/i.test(normalized)) return null;
  return clean;
}

function maxSimilarity(left: string[], right: string[]): number {
  let best = 0;
  for (const a of left) {
    for (const b of right) {
      best = Math.max(best, textSimilarity(a, b));
    }
  }
  return best;
}

function textSimilarity(a: string, b: string): number {
  const aNorm = normalizeName(a);
  const bNorm = normalizeName(b);
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return 0.86;
  return jaccard(tokens(aNorm), tokens(bNorm));
}

function uniqueEvidence(results: InternetSearchResult[]) {
  const seen = new Set<string>();
  const out = [];
  for (const result of results) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    out.push({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      source: result.source,
      tier: INTERNET_SEARCH_EVIDENCE_TIER,
    });
  }
  return out;
}

function dedupeCurationDrafts(drafts: ProjectCurationDraft[]): ProjectCurationDraft[] {
  const seen = new Set<string>();
  const out: ProjectCurationDraft[] = [];
  for (const draft of drafts) {
    const key = [normalizeName(draft.projectName ?? ""), normalizeName(draft.buildingName ?? "")].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(draft);
  }
  return out;
}

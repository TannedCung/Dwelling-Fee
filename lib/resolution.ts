import { and, eq, isNull, or, ilike, sql, type SQL } from "drizzle-orm";
import { getDb, type DbExecutor } from "../db/client";
import { building, project, property } from "../db/schema";
import type { PropertyExtraction } from "./extraction/schema";
import { normalizeName, tokens, jaccard, splitNameTags, uniqueText } from "./text";

/**
 * Deterministic entity resolution (design §5). Phase 1 uses blocking + weighted
 * scoring + decision bands — embeddings come in Phase 3 once there's labeled data
 * to tune against. Merges (and unmerges) are handled separately via property_merge.
 */

// Decision thresholds on the combined score (0..1).
const AUTO_LINK = 0.8; // confident same property → link automatically
const REVIEW_MIN = 0.45; // plausible but uncertain → human review queue

export interface Candidate {
  id: string;
  name: string | null;
  projectId: string | null;
  buildingId: string | null;
  projectName: string | null;
  buildingName: string | null;
  houseNumber: string | null;
  aliases: unknown;
  wikiNotes: string | null;
  type: string;
  addressText: string | null;
  score: number;
}

export type Resolution =
  | { action: "link"; propertyId: string; candidates: Candidate[] }
  | { action: "review"; candidates: Candidate[] }
  | { action: "create"; candidates: Candidate[] };

/**
 * Combined match score: hierarchy dominates when present, while legacy flat
 * names remain useful as fallback for existing data.
 */
export function score(
  extraction: PropertyExtraction,
  cand: {
    name: string | null;
    projectId?: string | null;
    buildingId?: string | null;
    projectName?: string | null;
    buildingName?: string | null;
    houseNumber?: string | null;
    aliases?: unknown;
    wikiNotes?: string | null;
    type: string;
    attributes: unknown;
  },
): number {
  const aliases = aliasesFromCandidate(cand);
  const projectSim = maxTextSim(
    cleanProjectName(extraction.projectName ?? extraction.name),
    projectIdentityValues(cand, aliases),
  );
  const buildingSim = textSim(extraction.buildingName, cand.buildingName);
  const houseSim = textSim(extraction.houseNumber, cand.houseNumber);
  const nameSim = maxTextSim(displayName(extraction), [cand.name, cand.projectName, ...aliases]);

  const typeMatch = extraction.type !== "unknown" && extraction.type === cand.type ? 1 : 0;

  let areaMatch = 0;
  const candArea = (cand.attributes as { areaM2?: number } | null)?.areaM2;
  if (extraction.areaM2 != null && candArea != null && candArea > 0) {
    areaMatch = Math.abs(extraction.areaM2 - candArea) / candArea <= 0.1 ? 1 : 0;
  }

  // Unit labels like "Căn 1" are meaningful only with a project/building/location.
  const hasHierarchy = Boolean(extraction.projectName || extraction.buildingName || cand.projectName || cand.buildingName);
  let identityScore: number;
  if (isProjectLevelCandidate(cand)) {
    identityScore = 0.76 * projectSim + 0.14 * nameSim;
  } else {
    identityScore = hasHierarchy
      ? 0.42 * projectSim + 0.22 * buildingSim + 0.18 * houseSim + 0.08 * nameSim
      : 0.72 * nameSim;
  }

  return identityScore + 0.1 * typeMatch + 0.1 * areaMatch;
}

/** Find candidate canonical properties for an extraction, ranked by score. */
export async function findCandidates(extraction: PropertyExtraction, db: DbExecutor = getDb()): Promise<Candidate[]> {
  const blockingTokens = uniqueText([
    ...tokens(normalizeName(cleanProjectName(extraction.projectName ?? extraction.name) ?? "")),
    ...tokens(normalizeName(extraction.buildingName ?? "")),
    ...tokens(normalizeName(extraction.houseNumber ?? "")),
    ...tokens(normalizeName(extraction.locationText ?? "")),
    ...extraction.aliases.flatMap((alias) => tokens(normalizeName(alias))),
  ]);
  if (blockingTokens.length === 0) return [];

  // Block on shared tokens (substring of the normalized name) to avoid scanning everything.
  const clauses: SQL[] = [];
  for (const t of blockingTokens) {
    clauses.push(ilike(property.nameNormalized, `%${t}%`));
    clauses.push(ilike(property.projectNameNormalized, `%${t}%`));
    clauses.push(ilike(property.buildingNameNormalized, `%${t}%`));
    clauses.push(ilike(property.houseNumberNormalized, `%${t}%`));
    clauses.push(sql`${property.aliases}::text ilike ${`%${t}%`}`);
    clauses.push(sql`${property.tags}::text ilike ${`%${t}%`}`);
    clauses.push(ilike(property.wikiNotes, `%${t}%`));
    clauses.push(ilike(project.nameNormalized, `%${t}%`));
    clauses.push(sql`${project.aliases}::text ilike ${`%${t}%`}`);
    clauses.push(sql`${project.tags}::text ilike ${`%${t}%`}`);
    clauses.push(ilike(project.wikiNotes, `%${t}%`));
    clauses.push(ilike(building.nameNormalized, `%${t}%`));
    clauses.push(sql`${building.aliases}::text ilike ${`%${t}%`}`);
    clauses.push(sql`${building.tags}::text ilike ${`%${t}%`}`);
    clauses.push(ilike(building.wikiNotes, `%${t}%`));
  }

  const rows = await db
    .select({
      id: property.id,
      name: property.name,
      projectId: property.projectId,
      buildingId: property.buildingId,
      projectName: property.projectName,
      buildingName: property.buildingName,
      projectEntityName: project.name,
      buildingEntityName: building.name,
      houseNumber: property.houseNumber,
      aliases: property.aliases,
      wikiNotes: property.wikiNotes,
      type: property.type,
      addressText: property.addressText,
      attributes: property.attributes,
    })
    .from(property)
    .leftJoin(project, eq(property.projectId, project.id))
    .leftJoin(building, eq(property.buildingId, building.id))
    .where(
      and(
        isNull(property.canonicalPropertyId), // only canonical records
        or(...clauses),
      ),
    )
    .limit(50);

  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      projectId: r.projectId,
      buildingId: r.buildingId,
      projectName: r.projectEntityName ?? r.projectName,
      buildingName: r.buildingEntityName ?? r.buildingName,
      houseNumber: r.houseNumber,
      aliases: r.aliases,
      wikiNotes: r.wikiNotes,
      type: r.type,
      addressText: r.addressText,
      score: score(extraction, r),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

/** Decide how to attach an extraction: auto-link, queue for review, or create new. */
export async function resolve(extraction: PropertyExtraction, db: DbExecutor = getDb()): Promise<Resolution> {
  const candidates = await findCandidates(extraction, db);
  const best = candidates[0];
  if (best && best.score >= AUTO_LINK) return { action: "link", propertyId: best.id, candidates };
  if (best && best.score >= REVIEW_MIN) return { action: "review", candidates };
  return { action: "create", candidates };
}

/** Create a canonical property from an extraction. Returns the new id. */
export async function createPropertyFromExtraction(extraction: PropertyExtraction, db: DbExecutor = getDb()): Promise<string> {
  const name = displayName(extraction);
  const projectName = cleanProjectName(extraction.projectName ?? null);
  const projectId = projectName ? await getOrCreateProject(projectName, extraction, db) : null;
  const buildingName = extraction.buildingName?.trim() || null;
  const buildingId = projectId && buildingName ? await getOrCreateBuilding(projectId, buildingName, extraction, db) : null;
  const tags = uniqueText([
    ...extraction.tags,
    ...splitNameTags(extraction.name).tags,
    ...splitNameTags(extraction.projectName).tags,
  ]);
  const aliases = uniqueText([
    extraction.name,
    extraction.projectName,
    ...extraction.aliases,
  ]).filter((alias) => normalizeName(alias) !== normalizeName(name ?? ""));
  const [row] = await db
    .insert(property)
    .values({
      name,
      nameNormalized: name ? normalizeName(name) : null,
      projectId,
      buildingId,
      projectName,
      projectNameNormalized: projectName ? normalizeName(projectName) : null,
      buildingName,
      buildingNameNormalized: buildingName ? normalizeName(buildingName) : null,
      houseNumber: extraction.houseNumber?.trim() || null,
      houseNumberNormalized: extraction.houseNumber ? normalizeName(extraction.houseNumber) : null,
      aliases: aliases.length > 0 ? aliases : null,
      tags: tags.length > 0 ? tags : null,
      type: extraction.type,
      addressText: extraction.locationText ?? null,
      attributes: extraction.areaM2 != null || extraction.bedrooms != null
        ? { areaM2: extraction.areaM2, bedrooms: extraction.bedrooms, tags }
        : null,
    })
    .returning({ id: property.id });
  return row!.id;
}

export async function hasGroundedHierarchy(extraction: PropertyExtraction, db: DbExecutor = getDb()): Promise<boolean> {
  const projectName = cleanProjectName(extraction.projectName ?? null);
  if (!projectName) return true;
  const existingProject = await findProjectByName(projectName, db);
  if (!existingProject) return false;
  const buildingName = extraction.buildingName?.trim();
  if (!buildingName) return true;
  return Boolean(await findBuildingByName(existingProject.id, buildingName, db));
}

export async function findProjectByName(name: string, db: DbExecutor = getDb()): Promise<{ id: string; name: string } | null> {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const row = await db.query.project.findFirst({
    columns: { id: true, name: true },
    where: and(isNull(project.canonicalProjectId), eq(project.nameNormalized, normalized)),
  });
  return row ?? null;
}

export async function findBuildingByName(
  projectId: string,
  name: string,
  db: DbExecutor = getDb(),
): Promise<{ id: string; name: string } | null> {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const row = await db.query.building.findFirst({
    columns: { id: true, name: true },
    where: and(isNull(building.canonicalBuildingId), eq(building.projectId, projectId), eq(building.nameNormalized, normalized)),
  });
  return row ?? null;
}

async function getOrCreateProject(name: string, extraction: PropertyExtraction, db: DbExecutor): Promise<string> {
  const existing = await findProjectByName(name, db);
  if (existing) return existing.id;
  const aliases = uniqueText([
    extraction.name,
    extraction.projectName,
    ...extraction.aliases,
  ]).filter((alias) => normalizeName(alias) !== normalizeName(name));
  const tags = uniqueText([
    ...extraction.tags,
    ...splitNameTags(extraction.name).tags,
    ...splitNameTags(extraction.projectName).tags,
  ]);
  const inserted = await db
    .insert(project)
    .values({
      name,
      nameNormalized: normalizeName(name),
      aliases: aliases.length > 0 ? aliases : null,
      tags: tags.length > 0 ? tags : null,
      addressText: extraction.locationText ?? null,
    })
    .onConflictDoNothing({ target: project.nameNormalized })
    .returning({ id: project.id });
  if (inserted[0]) return inserted[0].id;
  const raced = await findProjectByName(name, db);
  if (!raced) throw new Error("project create failed");
  return raced.id;
}

async function getOrCreateBuilding(
  projectId: string,
  name: string,
  extraction: PropertyExtraction,
  db: DbExecutor,
): Promise<string> {
  const existing = await findBuildingByName(projectId, name, db);
  if (existing) return existing.id;
  const tags = uniqueText(extraction.tags);
  const inserted = await db
    .insert(building)
    .values({
      projectId,
      name,
      nameNormalized: normalizeName(name),
      tags: tags.length > 0 ? tags : null,
      addressText: extraction.locationText ?? null,
    })
    .onConflictDoNothing({ target: [building.projectId, building.nameNormalized] })
    .returning({ id: building.id });
  if (inserted[0]) return inserted[0].id;
  const raced = await findBuildingByName(projectId, name, db);
  if (!raced) throw new Error("building create failed");
  return raced.id;
}

export function displayName(extraction: PropertyExtraction): string | null {
  const projectName = cleanProjectName(extraction.projectName ?? null);
  const hierarchy = uniqueText([projectName, extraction.buildingName, extraction.houseNumber]);
  if (hierarchy.length > 0) return hierarchy.join(" / ");

  const cleaned = cleanProjectName(extraction.name);
  if (cleaned && !isGenericUnitName(cleaned)) return cleaned;
  return extraction.locationText?.trim() || cleaned || null;
}

export function cleanProjectName(raw: string | null | undefined): string | null {
  return splitNameTags(raw).name;
}

function textSim(a: string | null | undefined, b: string | null | undefined): number {
  const aNorm = normalizeName(a ?? "");
  const bNorm = normalizeName(b ?? "");
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;
  return jaccard(tokens(aNorm), tokens(bNorm));
}

function maxTextSim(value: string | null | undefined, candidates: Array<string | null | undefined>): number {
  return candidates.reduce((best, candidate) => Math.max(best, textSim(value, candidate)), 0);
}

function aliasesFromCandidate(cand: { aliases?: unknown }): string[] {
  return Array.isArray(cand.aliases) ? cand.aliases.filter((v): v is string => typeof v === "string") : [];
}

function projectIdentityValues(
  cand: { name: string | null; projectName?: string | null },
  aliases: string[],
): Array<string | null | undefined> {
  const values = [cand.projectName ?? cand.name, cand.name, ...aliases];
  return uniqueText([
    ...values,
    ...values.map((value) => cleanProjectName(value)),
  ]);
}

function isGenericUnitName(value: string): boolean {
  return /^(?:căn|can|unit|apartment|apt|nhà|nha|lô|lo|lot)\s*[\w.-]+$/iu.test(value.trim());
}

function isProjectLevelCandidate(cand: {
  projectName?: string | null;
  name: string | null;
  buildingName?: string | null;
  houseNumber?: string | null;
}): boolean {
  return Boolean(cand.projectName && !cand.buildingName && !cand.houseNumber);
}

import { and, isNull, or, ilike, type SQL } from "drizzle-orm";
import { getDb, type DbExecutor } from "../db/client";
import { property } from "../db/schema";
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
  projectName: string | null;
  buildingName: string | null;
  houseNumber: string | null;
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
    projectName?: string | null;
    buildingName?: string | null;
    houseNumber?: string | null;
    type: string;
    attributes: unknown;
  },
): number {
  const projectSim = textSim(cleanProjectName(extraction.projectName ?? extraction.name), cand.projectName ?? cand.name);
  const buildingSim = textSim(extraction.buildingName, cand.buildingName);
  const houseSim = textSim(extraction.houseNumber, cand.houseNumber);
  const nameSim = textSim(displayName(extraction), cand.name);

  const typeMatch = extraction.type !== "unknown" && extraction.type === cand.type ? 1 : 0;

  let areaMatch = 0;
  const candArea = (cand.attributes as { areaM2?: number } | null)?.areaM2;
  if (extraction.areaM2 != null && candArea != null && candArea > 0) {
    areaMatch = Math.abs(extraction.areaM2 - candArea) / candArea <= 0.1 ? 1 : 0;
  }

  // Unit labels like "Căn 1" are meaningful only with a project/building/location.
  const hasHierarchy = Boolean(extraction.projectName || extraction.buildingName || cand.projectName || cand.buildingName);
  const identityScore = hasHierarchy
    ? 0.42 * projectSim + 0.22 * buildingSim + 0.18 * houseSim + 0.08 * nameSim
    : 0.72 * nameSim;

  return identityScore + 0.1 * typeMatch + 0.1 * areaMatch;
}

/** Find candidate canonical properties for an extraction, ranked by score. */
export async function findCandidates(extraction: PropertyExtraction, db: DbExecutor = getDb()): Promise<Candidate[]> {
  const blockingTokens = uniqueText([
    ...tokens(normalizeName(cleanProjectName(extraction.projectName ?? extraction.name) ?? "")),
    ...tokens(normalizeName(extraction.buildingName ?? "")),
    ...tokens(normalizeName(extraction.houseNumber ?? "")),
    ...tokens(normalizeName(extraction.locationText ?? "")),
  ]);
  if (blockingTokens.length === 0) return [];

  // Block on shared tokens (substring of the normalized name) to avoid scanning everything.
  const clauses: SQL[] = [];
  for (const t of blockingTokens) {
    clauses.push(ilike(property.nameNormalized, `%${t}%`));
    clauses.push(ilike(property.projectNameNormalized, `%${t}%`));
    clauses.push(ilike(property.buildingNameNormalized, `%${t}%`));
    clauses.push(ilike(property.houseNumberNormalized, `%${t}%`));
  }

  const rows = await db
    .select({
      id: property.id,
      name: property.name,
      projectName: property.projectName,
      buildingName: property.buildingName,
      houseNumber: property.houseNumber,
      type: property.type,
      addressText: property.addressText,
      attributes: property.attributes,
    })
    .from(property)
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
      projectName: r.projectName,
      buildingName: r.buildingName,
      houseNumber: r.houseNumber,
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
      projectName,
      projectNameNormalized: projectName ? normalizeName(projectName) : null,
      buildingName: extraction.buildingName?.trim() || null,
      buildingNameNormalized: extraction.buildingName ? normalizeName(extraction.buildingName) : null,
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

function isGenericUnitName(value: string): boolean {
  return /^(?:căn|can|unit|apartment|apt|nhà|nha|lô|lo|lot)\s*[\w.-]+$/iu.test(value.trim());
}

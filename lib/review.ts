import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { getDb, transaction, type DbExecutor } from "../db/client";
import { building, priceObservation, project, rawSignal } from "../db/schema";
import { PropertyExtraction } from "./extraction/schema";
import { findCandidates, createPropertyFromExtraction, cleanProjectName, type Candidate } from "./resolution";
import { normalizeName } from "./text";

/**
 * Human-in-the-loop review (design §2, §5): observations flagged needs_review are
 * surfaced with candidate property matches so a person can link, create, or dismiss.
 */

export interface ReviewItem {
  observationId: string;
  rawSignalId: string;
  rawText: string;
  sourceType: string;
  sourceRef: string | null;
  extraction: PropertyExtraction;
  createSuggestion: ReviewCreateSuggestion;
  priceVnd: number | null;
  confidence: number | null;
  candidates: Candidate[];
}

export interface ReviewCreateSuggestion {
  projectName: string | null;
  buildingName: string | null;
  houseNumber: string | null;
  label: string;
}

export interface ReviewHierarchyOptions {
  projects: Array<{ id: string; name: string }>;
  buildings: Array<{ id: string; projectId: string; projectName: string; name: string }>;
}

/** Cheap count of observations awaiting review — for the nav badge (no candidate lookups). */
export async function reviewQueueCount(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: count() })
    .from(priceObservation)
    .where(eq(priceObservation.needsReview, true));
  return row?.n ?? 0;
}

export async function listReviewQueue(limit = 50): Promise<ReviewItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      observationId: priceObservation.id,
      rawSignalId: priceObservation.rawSignalId,
      rawText: rawSignal.rawText,
      sourceType: rawSignal.sourceType,
      sourceRef: rawSignal.sourceRef,
      extracted: priceObservation.extracted,
      priceVnd: priceObservation.priceVnd,
      confidence: priceObservation.confidence,
    })
    .from(priceObservation)
    .innerJoin(rawSignal, eq(rawSignal.id, priceObservation.rawSignalId))
    .where(eq(priceObservation.needsReview, true))
    .orderBy(desc(priceObservation.createdAt))
    .limit(limit);

  const items: ReviewItem[] = [];
  for (const r of rows) {
    const extraction = PropertyExtraction.parse(r.extracted);
    items.push({
      observationId: r.observationId,
      rawSignalId: r.rawSignalId,
      rawText: r.rawText,
      sourceType: r.sourceType,
      sourceRef: r.sourceRef,
      extraction,
      createSuggestion: buildCreateSuggestion(extraction, r.rawText, r.sourceRef),
      priceVnd: r.priceVnd,
      confidence: r.confidence != null ? Number(r.confidence) : null,
      candidates: await findCandidates(extraction),
    });
  }
  return items;
}

export async function listReviewHierarchyOptions(): Promise<ReviewHierarchyOptions> {
  const db = getDb();
  const [projects, buildings] = await Promise.all([
    db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(isNull(project.canonicalProjectId))
      .orderBy(asc(project.name))
      .limit(200),
    db
      .select({
        id: building.id,
        projectId: building.projectId,
        projectName: project.name,
        name: building.name,
      })
      .from(building)
      .innerJoin(project, eq(building.projectId, project.id))
      .where(isNull(building.canonicalBuildingId))
      .orderBy(asc(project.name), asc(building.name))
      .limit(400),
  ]);
  return { projects, buildings };
}

export type ReviewAction =
  | { action: "link"; propertyId: string }
  | { action: "create"; projectName?: string | null; buildingName?: string | null; houseNumber?: string | null }
  | { action: "dismiss" };

/** Apply a reviewer decision to a queued observation, then refresh the signal status. */
export async function applyReview(observationId: string, decision: ReviewAction): Promise<void> {
  // Create-property + observation update + signal-status refresh are one atomic unit.
  await transaction(async (tx) => {
    const obs = await tx.query.priceObservation.findFirst({
      columns: { id: true, rawSignalId: true, extracted: true },
      where: eq(priceObservation.id, observationId),
    });
    if (!obs) throw new Error("observation not found");

    let propertyId: string | null = null;
    if (decision.action === "link") {
      propertyId = decision.propertyId;
    } else if (decision.action === "create") {
      propertyId = await createPropertyFromExtraction(creationExtraction(PropertyExtraction.parse(obs.extracted), decision), tx);
    }

    await tx
      .update(priceObservation)
      .set({ propertyId, needsReview: false })
      .where(eq(priceObservation.id, observationId));

    await refreshSignalStatus(obs.rawSignalId, tx);
  });
}

export function buildCreateSuggestion(
  extraction: PropertyExtraction,
  rawText = "",
  sourceRef: string | null = null,
): ReviewCreateSuggestion {
  const projectName = cleanProjectName(extraction.projectName ?? extraction.name);
  const buildingName = extraction.buildingName?.trim()
    || inferBuildingName(projectName, rawText, sourceRef)
    || null;
  const houseNumber = extraction.houseNumber?.trim() || null;
  const labelParts = [projectName, buildingName, houseNumber].filter((part): part is string => Boolean(part));
  return {
    projectName,
    buildingName,
    houseNumber,
    label: labelParts.length > 0 ? labelParts.join(" / ") : extraction.name ?? "(new property)",
  };
}

function creationExtraction(
  extraction: PropertyExtraction,
  decision: Extract<ReviewAction, { action: "create" }>,
): PropertyExtraction {
  const projectName = cleanProjectName(decision.projectName ?? extraction.projectName ?? extraction.name);
  const buildingName = decision.buildingName?.trim() || extraction.buildingName;
  const houseNumber = decision.houseNumber?.trim() || extraction.houseNumber;
  const label = [projectName, buildingName, houseNumber].filter(Boolean).join(" / ");
  return {
    ...extraction,
    name: label || extraction.name,
    projectName,
    buildingName,
    houseNumber,
  };
}

function inferBuildingName(projectName: string | null, rawText: string, sourceRef: string | null): string | null {
  if (!projectName) return null;
  const candidates = [
    titleLine(rawText),
    sourceRef,
    sourceUrlFromRawText(rawText),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const fromSlug = looksLikeUrl(candidate) ? inferBuildingFromUrl(projectName, candidate) : null;
    if (fromSlug) return fromSlug;
    const fromText = inferBuildingFromText(projectName, candidate);
    if (fromText) return fromText;
  }
  return null;
}

function titleLine(rawText: string): string | null {
  return rawText.match(/^Title:\s*(.+)$/im)?.[1]?.trim() || null;
}

function sourceUrlFromRawText(rawText: string): string | null {
  return rawText.match(/^Source URL:\s*(https?:\/\/\S+)/im)?.[1]?.trim() || null;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function inferBuildingFromUrl(projectName: string, rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    for (const segment of url.pathname.split("/").filter(Boolean)) {
      const inferred = inferBuildingFromSlugSegment(projectName, decodeURIComponent(segment));
      if (inferred) return inferred;
    }
  } catch {
    return null;
  }
  return null;
}

function inferBuildingFromSlugSegment(projectName: string, segment: string): string | null {
  const tokens = segment
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  const projectTokens = normalizeName(projectName).split(" ").filter(Boolean);
  const projectToken = projectTokens[projectTokens.length - 1];
  if (!projectToken) return null;
  const projectIndex = tokens.indexOf(projectToken);
  if (projectIndex <= 0) return null;

  const picked: string[] = [];
  for (let i = projectIndex - 1; i >= 0 && picked.length < 4; i--) {
    const token = tokens[i]!;
    if (BUILDING_STOP_WORDS.has(token)) {
      if (picked.length > 0) break;
      continue;
    }
    if (/^\d+$/.test(token)) continue;
    picked.push(token);
  }
  const buildingTokens = picked.reverse();
  return buildingTokens.length >= 2 ? titleCaseTokens(buildingTokens) : null;
}

function inferBuildingFromText(projectName: string, text: string): string | null {
  const normalizedProject = normalizeName(projectName);
  const normalizedText = normalizeName(text);
  if (!normalizedProject || !normalizedText.includes(normalizedProject)) return null;
  const beforeProject = normalizedText.slice(0, normalizedText.indexOf(normalizedProject)).trim();
  const tokens = beforeProject.split(" ").filter(Boolean);
  const picked: string[] = [];
  for (let i = tokens.length - 1; i >= 0 && picked.length < 4; i--) {
    const token = tokens[i]!;
    if (BUILDING_STOP_WORDS.has(token)) {
      if (picked.length > 0) break;
      continue;
    }
    picked.push(token);
  }
  return picked.length >= 2 ? titleCaseTokens(picked.reverse()) : null;
}

function titleCaseTokens(tokens: string[]): string {
  return tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(" ");
}

const BUILDING_STOP_WORDS = new Set([
  "ban",
  "cho",
  "thue",
  "can",
  "ho",
  "chung",
  "cu",
  "nha",
  "pho",
  "dat",
  "biet",
  "thu",
  "shophouse",
  "du",
  "an",
  "khu",
  "do",
  "thi",
  "xa",
  "phuong",
  "quan",
  "huyen",
  "thi",
  "tran",
  "tp",
  "hcm",
  "ha",
  "noi",
  "gia",
  "tot",
  "nhat",
  "moi",
  "chu",
  "nhan",
]);

/** Mark the signal 'extracted' once none of its observations still need review. */
async function refreshSignalStatus(rawSignalId: string, db: DbExecutor = getDb()): Promise<void> {
  const remaining = await db.query.priceObservation.findFirst({
    columns: { id: true },
    where: and(eq(priceObservation.rawSignalId, rawSignalId), eq(priceObservation.needsReview, true)),
  });
  if (!remaining) {
    await db.update(rawSignal).set({ status: "extracted" }).where(eq(rawSignal.id, rawSignalId));
  }
}

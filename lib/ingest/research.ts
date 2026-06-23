import { and, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DbExecutor } from "../../db/client";
import { building, project, property } from "../../db/schema";
import {
  INTERNET_SEARCH_EVIDENCE_TIER,
  searchInternetForProjectInformation,
  type InternetSearchOutput,
} from "../collection/internet-search";
import { normalizeName, tokens, uniqueText } from "../text";
import { debugEvent, type IngestDebugEvent } from "./debug";

const MAX_DB_MATCHES = 8;

export interface DbGroundingMatch {
  entityType: "project" | "building" | "property";
  id: string;
  name: string;
  projectName: string | null;
  buildingName: string | null;
  addressText: string | null;
  wikiNotes: string | null;
}

export interface IngestResearchContext {
  query: string | null;
  dbMatches: DbGroundingMatch[];
  internet: InternetSearchOutput | null;
  debug: IngestDebugEvent[];
}

export async function gatherIngestResearchContext(
  userContent: string,
  db: DbExecutor = getDb(),
): Promise<IngestResearchContext> {
  const debug: IngestDebugEvent[] = [];
  const query = buildResearchQuery(userContent);
  debug.push(debugEvent("research.query", "ok", query ? "Built research query from broker text." : "No project/building terms found.", { query }));

  let dbMatches: DbGroundingMatch[] = [];
  if (query) {
    debug.push(debugEvent("research.db", "started", "Searching existing project/building/property records.", { query }));
    try {
      dbMatches = await searchExistingEntities(query, db);
      debug.push(debugEvent("research.db", "ok", `Found ${dbMatches.length} existing DB candidate(s).`, {
        matches: dbMatches.map((m) => ({
          entityType: m.entityType,
          name: m.name,
          projectName: m.projectName,
          buildingName: m.buildingName,
        })),
      }));
    } catch (e) {
      debug.push(debugEvent("research.db", "error", e instanceof Error ? e.message : "Existing DB search failed."));
    }
  }

  let internet: InternetSearchOutput | null = null;
  if (query) {
    debug.push(debugEvent("research.internet", "started", "Searching internet for Tier 2 project/building context.", {
      tier: INTERNET_SEARCH_EVIDENCE_TIER,
      query,
    }));
    try {
      internet = await searchInternetForProjectInformation({
        query,
        purpose: "ingest grounding for project/building identity",
        limit: 5,
      });
      const status = internet.warnings.length > 0 ? "warning" : "ok";
      debug.push(debugEvent("research.internet", status, `Internet search returned ${internet.results.length} Tier 2 result(s).`, {
        tier: internet.tier,
        warnings: internet.warnings,
        results: internet.results.map((r) => ({ title: r.title, url: r.url, source: r.source, snippet: r.snippet })),
      }));
    } catch (e) {
      debug.push(debugEvent("research.internet", "error", e instanceof Error ? e.message : "Internet search failed."));
    }
  }

  return { query, dbMatches, internet, debug };
}

export function researchPromptBlock(ctx: IngestResearchContext): string {
  if (!ctx.query) return "";
  const dbLines = ctx.dbMatches.length === 0
    ? ["- No existing DB candidates found."]
    : ctx.dbMatches.map((m) => {
        const hierarchy = [m.projectName, m.buildingName].filter(Boolean).join(" / ");
        return `- ${m.entityType}: ${m.name}${hierarchy ? ` (${hierarchy})` : ""}${m.addressText ? `; address: ${m.addressText}` : ""}${m.wikiNotes ? `; notes: ${m.wikiNotes.slice(0, 240)}` : ""}`;
      });
  const internetLines = !ctx.internet || ctx.internet.results.length === 0
    ? [`- No internet results available.${ctx.internet?.warnings.length ? ` Warnings: ${ctx.internet.warnings.join("; ")}` : ""}`]
    : ctx.internet.results.map((r) => `- [Tier 2 unconfirmed] ${r.title} (${r.url}): ${r.snippet.slice(0, 240)}`);

  return `\n\nGROUNDING RESEARCH CONTEXT (for identity only; do not treat Tier 2 as verified facts):\nQuery: ${ctx.query}\nExisting DB candidates:\n${dbLines.join("\n")}\nInternet evidence:\n${internetLines.join("\n")}\nRules for using this context:\n- Use DB candidates and Tier 2 internet evidence to disambiguate project/building identity.\n- Do not invent prices, areas, or unit numbers from research context.\n- Do not ask which project the user means when the text plus research strongly indicates one project/building.\n- Preserve uncertainty by lowering confidence when evidence is incomplete or only Tier 2.`;
}

async function searchExistingEntities(query: string, db: DbExecutor): Promise<DbGroundingMatch[]> {
  const searchTokens = uniqueText(tokens(normalizeName(query))).slice(0, 8);
  if (searchTokens.length === 0) return [];
  const projectClauses: SQL[] = [];
  const buildingClauses: SQL[] = [];
  const propertyClauses: SQL[] = [];

  for (const token of searchTokens) {
    projectClauses.push(ilike(project.nameNormalized, `%${token}%`));
    projectClauses.push(sql`${project.aliases}::text ilike ${`%${token}%`}`);
    projectClauses.push(sql`${project.tags}::text ilike ${`%${token}%`}`);
    projectClauses.push(ilike(project.wikiNotes, `%${token}%`));

    buildingClauses.push(ilike(building.nameNormalized, `%${token}%`));
    buildingClauses.push(sql`${building.aliases}::text ilike ${`%${token}%`}`);
    buildingClauses.push(sql`${building.tags}::text ilike ${`%${token}%`}`);
    buildingClauses.push(ilike(building.wikiNotes, `%${token}%`));

    propertyClauses.push(ilike(property.nameNormalized, `%${token}%`));
    propertyClauses.push(ilike(property.projectNameNormalized, `%${token}%`));
    propertyClauses.push(ilike(property.buildingNameNormalized, `%${token}%`));
    propertyClauses.push(sql`${property.aliases}::text ilike ${`%${token}%`}`);
    propertyClauses.push(sql`${property.tags}::text ilike ${`%${token}%`}`);
    propertyClauses.push(ilike(property.wikiNotes, `%${token}%`));
  }

  const [projects, buildings, properties] = await Promise.all([
    db
      .select({
        id: project.id,
        name: project.name,
        addressText: project.addressText,
        wikiNotes: project.wikiNotes,
      })
      .from(project)
      .where(and(isNull(project.canonicalProjectId), or(...projectClauses)))
      .limit(MAX_DB_MATCHES),
    db
      .select({
        id: building.id,
        name: building.name,
        projectName: project.name,
        addressText: building.addressText,
        wikiNotes: building.wikiNotes,
      })
      .from(building)
      .leftJoin(project, sql`${building.projectId} = ${project.id}`)
      .where(and(isNull(building.canonicalBuildingId), or(...buildingClauses)))
      .limit(MAX_DB_MATCHES),
    db
      .select({
        id: property.id,
        name: property.name,
        projectName: property.projectName,
        buildingName: property.buildingName,
        addressText: property.addressText,
        wikiNotes: property.wikiNotes,
      })
      .from(property)
      .where(and(isNull(property.canonicalPropertyId), or(...propertyClauses)))
      .limit(MAX_DB_MATCHES),
  ]);

  return [
    ...projects.map((p) => ({
      entityType: "project" as const,
      id: p.id,
      name: p.name,
      projectName: p.name,
      buildingName: null,
      addressText: p.addressText,
      wikiNotes: p.wikiNotes,
    })),
    ...buildings.map((b) => ({
      entityType: "building" as const,
      id: b.id,
      name: b.name,
      projectName: b.projectName,
      buildingName: b.name,
      addressText: b.addressText,
      wikiNotes: b.wikiNotes,
    })),
    ...properties.map((p) => ({
      entityType: "property" as const,
      id: p.id,
      name: p.name ?? ([p.projectName, p.buildingName].filter(Boolean).join(" / ") || "(unnamed)"),
      projectName: p.projectName,
      buildingName: p.buildingName,
      addressText: p.addressText,
      wikiNotes: p.wikiNotes,
    })),
  ].slice(0, MAX_DB_MATCHES);
}

function buildResearchQuery(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const terms = uniqueText([
    ...matches(normalized, /(?:dự án|du an|project|khu|ở|tại|tai)\s+([\p{L}0-9][\p{L}0-9 -]{2,48})/giu),
    ...matches(normalized, /(?:tòa|toa|tower|building|block)\s+([\p{L}0-9][\p{L}0-9 -]{2,36})/giu),
    ...matches(normalized, /([A-ZĐ][\p{L}0-9]*(?:[ -]+[A-ZĐ][\p{L}0-9]*){0,3})/gu),
  ])
    .map((term) => cleanupTerm(term))
    .filter((term) => usefulTerm(term));

  if (terms.length === 0) return null;
  return ["real estate project", ...uniqueText(terms).slice(0, 6)].join(" ");
}

function matches(text: string, re: RegExp): string[] {
  return Array.from(text.matchAll(re)).map((match) => match[1] ?? "").filter(Boolean);
}

function cleanupTerm(term: string): string {
  return term
    .replace(/[.,:;!?].*$/u, "")
    .replace(/\b(?:căn|can|mỗi|moi|giá|gia|bán|ban|cho|thuê|thue|bao|phí|phi)\b.*$/iu, "")
    .trim();
}

function usefulTerm(term: string): boolean {
  const normalized = normalizeName(term);
  if (normalized.length < 3) return false;
  if (/^(cc|pn|vs|tl|m2|gia|ban|can|toa|tang|dong|nam|premium moi|project)$/i.test(normalized)) return false;
  return tokens(normalized).length > 0;
}

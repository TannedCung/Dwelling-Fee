import { and, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DbExecutor } from "../../db/client";
import { building, project, property } from "../../db/schema";
import {
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
  internetQuery: string | null;
  dbMatches: DbGroundingMatch[];
  internet: InternetSearchOutput | null;
  debug: IngestDebugEvent[];
}

export async function researchProjectInformation(
  query: string,
  purpose = "agent-requested project/building grounding",
  db: DbExecutor = getDb(),
): Promise<IngestResearchContext> {
  const searchQuery = query.trim();
  const debug: IngestDebugEvent[] = [];
  if (!searchQuery) return { query: null, internetQuery: null, dbMatches: [], internet: null, debug };

  debug.push(debugEvent("research.agent", "started", "Main ingest agent requested project/building research.", {
    query: searchQuery,
    purpose,
  }));

  let dbMatches: DbGroundingMatch[] = [];
  debug.push(debugEvent("research.db", "started", "Searching existing project/building/property records.", { query: searchQuery }));
  try {
    dbMatches = await searchExistingEntities(searchQuery, db);
    debug.push(debugEvent("research.db", "ok", `Found ${dbMatches.length} existing DB candidate(s).`, {
      query: searchQuery,
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

  let internet: InternetSearchOutput | null = null;
  try {
    internet = await searchInternetForProjectInformation({
      query: searchQuery,
      purpose,
      limit: 5,
    });
    const status = internet.warnings.length > 0 ? "warning" : "ok";
    debug.push(debugEvent("research.internet", status, `Internet search returned ${internet.results.length} Tier 2 result(s).`, {
      tier: internet.tier,
      query: searchQuery,
      warnings: internet.warnings,
      results: internet.results.map((r) => ({ title: r.title, url: r.url, source: r.source, snippet: r.snippet })),
    }));
  } catch (e) {
    debug.push(debugEvent("research.internet", "error", e instanceof Error ? e.message : "Internet search failed."));
  }

  return { query: searchQuery, internetQuery: searchQuery, dbMatches, internet, debug };
}

export async function searchExistingEntities(query: string, db: DbExecutor): Promise<DbGroundingMatch[]> {
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

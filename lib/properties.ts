import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { building, project, property, priceObservation } from "../db/schema";
import { distribution, type Distribution } from "./stats";

export interface PropertyListItem {
  id: string;
  name: string | null;
  projectId: string | null;
  buildingId: string | null;
  projectName: string | null;
  buildingName: string | null;
  houseNumber: string | null;
  tags: string[];
  type: string;
  addressText: string | null;
  obsCount: number;
  lastSeen: Date | null;
  saleDistribution: Distribution;
}

export async function listProperties(limit = 100): Promise<PropertyListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: property.id,
      name: property.name,
      projectId: property.projectId,
      buildingId: property.buildingId,
      projectName: sql<string | null>`coalesce(${project.name}, ${property.projectName})`,
      buildingName: sql<string | null>`coalesce(${building.name}, ${property.buildingName})`,
      houseNumber: property.houseNumber,
      tags: property.tags,
      type: property.type,
      addressText: property.addressText,
      obsCount: sql<number>`count(${priceObservation.id})`.mapWith(Number),
    })
    .from(property)
    .leftJoin(project, eq(property.projectId, project.id))
    .leftJoin(building, eq(property.buildingId, building.id))
    .leftJoin(priceObservation, eq(priceObservation.propertyId, property.id))
    .groupBy(property.id, project.id, building.id)
    .orderBy(desc(sql`count(${priceObservation.id})`))
    .limit(limit);
  const ids = rows.map((p) => p.id);
  const obs = ids.length === 0
    ? []
    : await db
        .select({
          propertyId: priceObservation.propertyId,
          createdAt: priceObservation.createdAt,
          observedAt: priceObservation.observedAt,
          listingType: priceObservation.listingType,
          pricePerM2: priceObservation.pricePerM2,
        })
        .from(priceObservation)
        .where(inArray(priceObservation.propertyId, ids));

  const byProperty = new Map<string, { salePpm2: number[]; lastSeen: Date | null }>();
  for (const o of obs) {
    if (!o.propertyId) continue;
    const bucket = byProperty.get(o.propertyId) ?? { salePpm2: [], lastSeen: null };
    const seenAt = o.observedAt ?? o.createdAt;
    if (bucket.lastSeen == null || seenAt > bucket.lastSeen) bucket.lastSeen = seenAt;
    if (o.listingType === "sale" && o.pricePerM2 != null) bucket.salePpm2.push(Number(o.pricePerM2));
    byProperty.set(o.propertyId, bucket);
  }

  return rows.map((p) => {
    const bucket = byProperty.get(p.id) ?? { salePpm2: [], lastSeen: null };
    return {
      ...p,
      tags: Array.isArray(p.tags) ? p.tags.filter((tag): tag is string => typeof tag === "string") : [],
      lastSeen: bucket.lastSeen,
      saleDistribution: distribution(bucket.salePpm2),
    };
  });
}

export interface ObservationPoint {
  id: string;
  t: number; // epoch ms (observed_at, fallback created_at)
  pricePerM2: number | null;
  priceVnd: number | null;
  areaM2: number | null;
  listingType: string;
  dealStatus: string;
  sourceType: string;
  confidence: number | null;
}

export interface PropertyDetail {
  id: string;
  name: string | null;
  projectId: string | null;
  buildingId: string | null;
  projectName: string | null;
  buildingName: string | null;
  houseNumber: string | null;
  tags: string[];
  type: string;
  addressText: string | null;
  observations: ObservationPoint[];
  /** price/m² distribution over `sale` observations only (asking + transacted shown separately upstream). */
  saleDistribution: Distribution;
}

export async function getProperty(id: string): Promise<PropertyDetail | null> {
  const db = getDb();
  const [p] = await db
    .select({
      id: property.id,
      name: property.name,
      projectId: property.projectId,
      buildingId: property.buildingId,
      projectName: sql<string | null>`coalesce(${project.name}, ${property.projectName})`,
      buildingName: sql<string | null>`coalesce(${building.name}, ${property.buildingName})`,
      houseNumber: property.houseNumber,
      tags: property.tags,
      type: property.type,
      addressText: property.addressText,
    })
    .from(property)
    .leftJoin(project, eq(property.projectId, project.id))
    .leftJoin(building, eq(property.buildingId, building.id))
    .where(eq(property.id, id))
    .limit(1);
  if (!p) return null;

  const obs = await db
    .select({
      id: priceObservation.id,
      observedAt: priceObservation.observedAt,
      createdAt: priceObservation.createdAt,
      pricePerM2: priceObservation.pricePerM2,
      priceVnd: priceObservation.priceVnd,
      areaM2: priceObservation.areaM2,
      listingType: priceObservation.listingType,
      dealStatus: priceObservation.dealStatus,
      sourceType: priceObservation.sourceType,
      confidence: priceObservation.confidence,
    })
    .from(priceObservation)
    .where(eq(priceObservation.propertyId, id))
    .orderBy(priceObservation.createdAt);

  const observations: ObservationPoint[] = obs.map((o) => ({
    id: o.id,
    t: (o.observedAt ?? o.createdAt).getTime(),
    pricePerM2: o.pricePerM2 != null ? Number(o.pricePerM2) : null,
    priceVnd: o.priceVnd,
    areaM2: o.areaM2 != null ? Number(o.areaM2) : null,
    listingType: o.listingType,
    dealStatus: o.dealStatus,
    sourceType: o.sourceType,
    confidence: o.confidence != null ? Number(o.confidence) : null,
  }));

  const salePpm2 = observations
    .filter((o) => o.listingType === "sale" && o.pricePerM2 != null)
    .map((o) => o.pricePerM2!);

  return {
    id: p.id,
    name: p.name,
    projectId: p.projectId,
    buildingId: p.buildingId,
    projectName: p.projectName,
    buildingName: p.buildingName,
    houseNumber: p.houseNumber,
    tags: Array.isArray(p.tags) ? p.tags.filter((tag): tag is string => typeof tag === "string") : [],
    type: p.type,
    addressText: p.addressText,
    observations,
    saleDistribution: distribution(salePpm2),
  };
}

export interface ProjectListItem {
  id: string;
  name: string;
  tags: string[];
  addressText: string | null;
  buildingCount: number;
  propertyCount: number;
  obsCount: number;
  lastSeen: Date | null;
  saleDistribution: Distribution;
}

export interface BuildingListItem {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  tags: string[];
  addressText: string | null;
  propertyCount: number;
  obsCount: number;
  lastSeen: Date | null;
  saleDistribution: Distribution;
}

export interface ProjectDetail extends ProjectListItem {
  wikiNotes: string | null;
  aiSummary: string | null;
  buildings: BuildingListItem[];
  properties: PropertyListItem[];
}

export interface BuildingDetail extends BuildingListItem {
  wikiNotes: string | null;
  aiSummary: string | null;
  properties: PropertyListItem[];
}

export async function listProjects(limit = 100): Promise<ProjectListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: project.id,
      name: project.name,
      tags: project.tags,
      addressText: project.addressText,
      buildingCount: sql<number>`count(distinct ${building.id})`.mapWith(Number),
      propertyCount: sql<number>`count(distinct ${property.id})`.mapWith(Number),
      obsCount: sql<number>`count(${priceObservation.id})`.mapWith(Number),
    })
    .from(project)
    .leftJoin(building, eq(building.projectId, project.id))
    .leftJoin(property, eq(property.projectId, project.id))
    .leftJoin(priceObservation, eq(priceObservation.propertyId, property.id))
    .groupBy(project.id)
    .orderBy(desc(sql`count(${priceObservation.id})`), asc(project.name))
    .limit(limit);

  const stats = await projectStats(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    tags: textArray(r.tags),
    lastSeen: stats.get(r.id)?.lastSeen ?? null,
    saleDistribution: distribution(stats.get(r.id)?.salePpm2 ?? []),
  }));
}

export async function getProject(id: string): Promise<ProjectDetail | null> {
  const db = getDb();
  const p = await db.query.project.findFirst({ where: eq(project.id, id) });
  if (!p) return null;
  const [summary] = await listProjectsByIds([id]);
  const buildings = await listBuildings(id);
  const properties = await listPropertiesForProject(id);
  return {
    ...(summary ?? {
      id: p.id,
      name: p.name,
      tags: textArray(p.tags),
      addressText: p.addressText,
      buildingCount: buildings.length,
      propertyCount: properties.length,
      obsCount: 0,
      lastSeen: null,
      saleDistribution: distribution([]),
    }),
    wikiNotes: p.wikiNotes,
    aiSummary: p.aiSummary,
    buildings,
    properties,
  };
}

export async function listBuildings(projectId?: string, limit = 100): Promise<BuildingListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: building.id,
      projectId: building.projectId,
      projectName: project.name,
      name: building.name,
      tags: building.tags,
      addressText: building.addressText,
      propertyCount: sql<number>`count(distinct ${property.id})`.mapWith(Number),
      obsCount: sql<number>`count(${priceObservation.id})`.mapWith(Number),
    })
    .from(building)
    .innerJoin(project, eq(building.projectId, project.id))
    .leftJoin(property, eq(property.buildingId, building.id))
    .leftJoin(priceObservation, eq(priceObservation.propertyId, property.id))
    .where(projectId ? eq(building.projectId, projectId) : undefined)
    .groupBy(building.id, project.id)
    .orderBy(desc(sql`count(${priceObservation.id})`), asc(building.name))
    .limit(limit);

  const stats = await buildingStats(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    tags: textArray(r.tags),
    lastSeen: stats.get(r.id)?.lastSeen ?? null,
    saleDistribution: distribution(stats.get(r.id)?.salePpm2 ?? []),
  }));
}

export async function getBuilding(id: string): Promise<BuildingDetail | null> {
  const db = getDb();
  const b = await db.query.building.findFirst({ where: eq(building.id, id) });
  if (!b) return null;
  const [summary] = await listBuildingsByIds([id]);
  const properties = await listPropertiesForBuilding(id);
  if (!summary) return null;
  return {
    ...summary,
    wikiNotes: b.wikiNotes,
    aiSummary: b.aiSummary,
    properties,
  };
}

async function listProjectsByIds(ids: string[]): Promise<ProjectListItem[]> {
  if (ids.length === 0) return [];
  const all = await listProjects(500);
  return all.filter((p) => ids.includes(p.id));
}

async function listBuildingsByIds(ids: string[]): Promise<BuildingListItem[]> {
  if (ids.length === 0) return [];
  const all = await listBuildings(undefined, 500);
  return all.filter((b) => ids.includes(b.id));
}

async function listPropertiesForProject(projectId: string): Promise<PropertyListItem[]> {
  const all = await listProperties(500);
  return all.filter((p) => p.projectId === projectId);
}

async function listPropertiesForBuilding(buildingId: string): Promise<PropertyListItem[]> {
  const all = await listProperties(500);
  return all.filter((p) => p.buildingId === buildingId);
}

async function projectStats(ids: string[]): Promise<Map<string, { salePpm2: number[]; lastSeen: Date | null }>> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  const obs = await db
    .select({
      projectId: property.projectId,
      createdAt: priceObservation.createdAt,
      observedAt: priceObservation.observedAt,
      listingType: priceObservation.listingType,
      pricePerM2: priceObservation.pricePerM2,
    })
    .from(priceObservation)
    .innerJoin(property, eq(priceObservation.propertyId, property.id))
    .where(inArray(property.projectId, ids));
  const out = new Map<string, { salePpm2: number[]; lastSeen: Date | null }>();
  for (const o of obs) {
    if (!o.projectId) continue;
    collectStat(out, o.projectId, o);
  }
  return out;
}

async function buildingStats(ids: string[]): Promise<Map<string, { salePpm2: number[]; lastSeen: Date | null }>> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  const obs = await db
    .select({
      buildingId: property.buildingId,
      createdAt: priceObservation.createdAt,
      observedAt: priceObservation.observedAt,
      listingType: priceObservation.listingType,
      pricePerM2: priceObservation.pricePerM2,
    })
    .from(priceObservation)
    .innerJoin(property, eq(priceObservation.propertyId, property.id))
    .where(inArray(property.buildingId, ids));
  const out = new Map<string, { salePpm2: number[]; lastSeen: Date | null }>();
  for (const o of obs) {
    if (!o.buildingId) continue;
    collectStat(out, o.buildingId, o);
  }
  return out;
}

function collectStat(
  out: Map<string, { salePpm2: number[]; lastSeen: Date | null }>,
  key: string,
  o: { observedAt: Date | null; createdAt: Date; listingType: string; pricePerM2: string | null },
) {
  const bucket = out.get(key) ?? { salePpm2: [], lastSeen: null };
  const seenAt = o.observedAt ?? o.createdAt;
  if (bucket.lastSeen == null || seenAt > bucket.lastSeen) bucket.lastSeen = seenAt;
  if (o.listingType === "sale" && o.pricePerM2 != null) bucket.salePpm2.push(Number(o.pricePerM2));
  out.set(key, bucket);
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
}

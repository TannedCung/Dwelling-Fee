import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { property, priceObservation } from "../db/schema";
import { distribution, type Distribution } from "./stats";

export interface PropertyListItem {
  id: string;
  name: string | null;
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
      projectName: property.projectName,
      buildingName: property.buildingName,
      houseNumber: property.houseNumber,
      tags: property.tags,
      type: property.type,
      addressText: property.addressText,
      obsCount: sql<number>`count(${priceObservation.id})`.mapWith(Number),
    })
    .from(property)
    .leftJoin(priceObservation, eq(priceObservation.propertyId, property.id))
    .groupBy(property.id)
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
  const p = await db.query.property.findFirst({ where: eq(property.id, id) });
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

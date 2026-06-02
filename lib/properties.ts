import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { property, priceObservation } from "../db/schema";
import { distribution, type Distribution } from "./stats";

export interface PropertyListItem {
  id: string;
  name: string | null;
  type: string;
  addressText: string | null;
  obsCount: number;
}

export async function listProperties(limit = 100): Promise<PropertyListItem[]> {
  const db = getDb();
  return db
    .select({
      id: property.id,
      name: property.name,
      type: property.type,
      addressText: property.addressText,
      obsCount: sql<number>`count(${priceObservation.id})`.mapWith(Number),
    })
    .from(property)
    .leftJoin(priceObservation, eq(priceObservation.propertyId, property.id))
    .groupBy(property.id)
    .orderBy(desc(sql`count(${priceObservation.id})`))
    .limit(limit);
}

export interface ObservationPoint {
  id: string;
  t: number; // epoch ms (observed_at, fallback created_at)
  pricePerM2: number | null;
  priceVnd: number | null;
  listingType: string;
  dealStatus: string;
  sourceType: string;
}

export interface PropertyDetail {
  id: string;
  name: string | null;
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
      listingType: priceObservation.listingType,
      dealStatus: priceObservation.dealStatus,
      sourceType: priceObservation.sourceType,
    })
    .from(priceObservation)
    .where(eq(priceObservation.propertyId, id))
    .orderBy(priceObservation.createdAt);

  const observations: ObservationPoint[] = obs.map((o) => ({
    id: o.id,
    t: (o.observedAt ?? o.createdAt).getTime(),
    pricePerM2: o.pricePerM2 != null ? Number(o.pricePerM2) : null,
    priceVnd: o.priceVnd,
    listingType: o.listingType,
    dealStatus: o.dealStatus,
    sourceType: o.sourceType,
  }));

  const salePpm2 = observations
    .filter((o) => o.listingType === "sale" && o.pricePerM2 != null)
    .map((o) => o.pricePerM2!);

  return {
    id: p.id,
    name: p.name,
    type: p.type,
    addressText: p.addressText,
    observations,
    saleDistribution: distribution(salePpm2),
  };
}

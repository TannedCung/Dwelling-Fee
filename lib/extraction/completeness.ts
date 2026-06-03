import type { PropertyExtraction } from "./schema";

/**
 * What counts as "enough necessary information" to commit a property observation.
 *
 * The product's primary metric is price/m² over time, segmented by listing type.
 * An observation is only useful — and resolvable/placeable — when it has all of:
 *   price · price basis · listing type · area · an identity (name or location).
 *
 * Anything missing is something the ingest assistant must ASK for rather than
 * guess. dealStatus/type are intentionally NOT required (brokers rarely state
 * them; sensible defaults apply and they don't block analytics).
 *
 * This module is pure (no DB/LLM) so the UI and the server share one definition.
 */
export interface FieldRequirement {
  key: string;
  label: string;
  missing: (p: PropertyExtraction) => boolean;
}

export const REQUIRED_FIELDS: FieldRequirement[] = [
  { key: "price", label: "price", missing: (p) => p.priceVnd == null },
  { key: "priceBasis", label: "price basis (total or per m²)", missing: (p) => p.priceBasis === "unknown" },
  { key: "listingType", label: "listing type (sale or rent)", missing: (p) => p.listingType === "unknown" },
  { key: "area", label: "area (m²)", missing: (p) => p.areaM2 == null },
  { key: "identity", label: "project/property identity or location", missing: (p) => !hasIdentity(p) },
];

/** Human-readable list of required fields still missing for a property. */
export function missingFields(p: PropertyExtraction): string[] {
  return REQUIRED_FIELDS.filter((r) => r.missing(p)).map((r) => r.label);
}

export function isComplete(p: PropertyExtraction): boolean {
  return REQUIRED_FIELDS.every((r) => !r.missing(p));
}

/** A draft is committable only when it has at least one property and all are complete. */
export function draftReady(properties: PropertyExtraction[]): boolean {
  return properties.length > 0 && properties.every(isComplete);
}

/** Per-property breakdown of what's still needed (for prompts and UI). */
export function incompleteSummary(properties: PropertyExtraction[]): string[] {
  return properties
    .map((p, i) => ({ p, i, miss: missingFields(p) }))
    .filter((x) => x.miss.length > 0)
    .map((x) => `#${x.i + 1} ${identityLabel(x.p)}: needs ${x.miss.join(", ")}`);
}

function hasIdentity(p: PropertyExtraction): boolean {
  if (p.projectName || p.name || p.locationText) return true;
  // Unit-only labels like "Căn 1" are not enough unless there is a surrounding
  // location/address context that makes them resolvable.
  return Boolean(p.houseNumber && p.locationText);
}

export function identityLabel(p: PropertyExtraction): string {
  const parts = [p.projectName, p.buildingName, p.houseNumber].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : p.name ?? p.locationText ?? "(unnamed)";
}

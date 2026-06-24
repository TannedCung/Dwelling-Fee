import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { building, priceObservation, project, property, location } from "../db/schema";
import { distribution, quantile, MIN_SAMPLE, type Distribution } from "./stats";

/**
 * Market-intelligence analytics (design §7). We NEVER mix listing_type,
 * deal_status, or property_type into one statistic — asking ≠ transacted,
 * sale ≠ rent, apartment ≠ land. Every aggregate carries its sample size and
 * small segments (n < MIN_SAMPLE) are flagged so the UI can dim them.
 *
 * The dataset is small in Phase 1, so we pull the relevant observations once
 * and compute medians/IQR/series in JS (mirrors lib/properties.ts). Move the
 * heavy percentiles into SQL (percentile_cont) when volume grows.
 */

export type DealFilter = "all" | "asking" | "transacted";
export type Period = 3 | 6 | 12;

export interface AnalyticsFilters {
  /** property type, or "all" for the cross-type market overview */
  type: string;
  /** project name, or "all" */
  project: string;
  /** building/block name within the project, or "all" */
  building: string;
  deal: DealFilter;
  period: Period;
}

export const DEFAULT_FILTERS: AnalyticsFilters = {
  type: "all",
  project: "all",
  building: "all",
  deal: "all",
  period: 12,
};

/** Normalized observation row used by all of the compute helpers. */
interface ObsRow {
  ppm2: number | null; // price per m² in VND
  listingType: string;
  dealStatus: string;
  propertyType: string;
  projectName: string | null;
  buildingName: string | null;
  area: string | null; // district / location label
  at: Date; // observed_at, fallback created_at
}

export interface Segment {
  propertyType: string;
  dealStatus: string;
  dist: Distribution;
  underpowered: boolean;
}

export interface TrendPoint {
  key: string; // YYYY-MM
  label: string; // T1..T12
  asking: number | null; // median ppm2 (VND), null when no data that month
  transacted: number | null;
  volume: number;
}

export interface RankedRow {
  label: string;
  value: number; // median ppm2 (VND)
  n: number;
  dim: boolean;
}

export interface HistogramData {
  lo: number; // VND
  step: number; // VND
  bins: number[];
}

export interface ActivityCol {
  label: string;
  value: number;
}

export interface FilterOptions {
  types: { id: string; label: string; count: number }[];
  projects: string[];
  buildings: string[]; // valid for the currently-selected project
}

export interface AnalyticsData {
  filters: AnalyticsFilters;
  options: FilterOptions;
  mode: "overview" | "deepdive";
  totalObs: number;
  /** overview: IQR segments grouped by (propertyType, dealStatus) */
  segments: Segment[];
  underpowered: number;
  /** mean asking→transacted discount across types, percent; null if not derivable */
  avgDiscountPct: number | null;
  /** deep-dive: monthly asking/transacted median + volume */
  trend: TrendPoint[];
  trendPct: number | null; // asking change over the window
  discountPct: number | null;
  districts: RankedRow[];
  histogram: HistogramData | null;
  /** activity columns (monthly transaction volume) shared by both modes */
  activity: ActivityCol[];
}

const TYPE_LABELS: Record<string, string> = {
  apartment: "Apartment",
  house: "Townhouse",
  project: "Project",
  land: "Land",
  villa: "Villa",
  unknown: "Other",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

// ── month axis helpers ──────────────────────────────────────────────────────

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Rolling list of the last `period` months ending at `now` (oldest first). */
export function monthAxis(period: Period, now = new Date()): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = period - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ key: monthKey(d), label: `T${d.getUTCMonth() + 1}` });
  }
  return out;
}

// ── pure compute helpers (exported for tests) ───────────────────────────────

/** Monthly median asking/transacted ppm2 + total volume over the month axis. */
export function monthlyTrend(rows: ObsRow[], axis: { key: string; label: string }[]): TrendPoint[] {
  const byMonth = new Map<string, { asking: number[]; transacted: number[]; volume: number }>();
  for (const { key } of axis) byMonth.set(key, { asking: [], transacted: [], volume: 0 });
  for (const r of rows) {
    const bucket = byMonth.get(monthKey(r.at));
    if (!bucket) continue;
    bucket.volume += 1;
    if (r.ppm2 == null) continue;
    if (r.dealStatus === "transacted") bucket.transacted.push(r.ppm2);
    else if (r.dealStatus === "asking") bucket.asking.push(r.ppm2);
  }
  return axis.map(({ key, label }) => {
    const b = byMonth.get(key)!;
    return {
      key,
      label,
      asking: b.asking.length ? quantile(b.asking, 0.5) : null,
      transacted: b.transacted.length ? quantile(b.transacted, 0.5) : null,
      volume: b.volume,
    };
  });
}

/** Median ppm2 ranked by area/district label, small samples dimmed. */
export function rankByArea(rows: ObsRow[]): RankedRow[] {
  const byArea = new Map<string, number[]>();
  for (const r of rows) {
    if (r.ppm2 == null || !r.area) continue;
    if (!byArea.has(r.area)) byArea.set(r.area, []);
    byArea.get(r.area)!.push(r.ppm2);
  }
  return [...byArea.entries()]
    .map(([label, vals]) => {
      const median = quantile(vals, 0.5) ?? 0;
      return { label, value: median, n: vals.length, dim: vals.length < MIN_SAMPLE };
    })
    .sort((a, b) => b.value - a.value);
}

/** Fixed-width histogram of ppm2 values; null when too few values to be meaningful. */
export function histogramBins(values: number[], targetBins = 7): HistogramData | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < MIN_SAMPLE) return null;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  if (max <= min) return null;
  // round the step to a "nice" 1M-VND multiple so axis labels read cleanly
  const ONE_M = 1_000_000;
  const rawStep = (max - min) / targetBins;
  const step = Math.max(ONE_M, Math.round(rawStep / ONE_M) * ONE_M);
  const lo = Math.floor(min / step) * step;
  const count = Math.max(1, Math.ceil((max - lo) / step));
  const bins = new Array(count).fill(0);
  for (const v of clean) {
    const idx = Math.min(count - 1, Math.floor((v - lo) / step));
    bins[idx] += 1;
  }
  return { lo, step, bins };
}

function buildSegments(rows: ObsRow[]): Segment[] {
  const buckets = new Map<string, { propertyType: string; dealStatus: string; vals: number[] }>();
  for (const r of rows) {
    if (r.ppm2 == null) continue;
    if (r.dealStatus !== "asking" && r.dealStatus !== "transacted") continue;
    const k = `${r.propertyType}|${r.dealStatus}`;
    if (!buckets.has(k)) buckets.set(k, { propertyType: r.propertyType, dealStatus: r.dealStatus, vals: [] });
    buckets.get(k)!.vals.push(r.ppm2);
  }
  return [...buckets.values()]
    .map(({ propertyType, dealStatus, vals }) => {
      const dist = distribution(vals);
      return { propertyType, dealStatus, dist, underpowered: dist.n < MIN_SAMPLE };
    })
    .sort((a, b) => b.dist.n - a.dist.n);
}

/** asking→transacted discount % for a set of rows; null if either side missing. */
function discountFor(rows: ObsRow[]): number | null {
  const asking = rows.filter((r) => r.dealStatus === "asking" && r.ppm2 != null).map((r) => r.ppm2!);
  const transacted = rows.filter((r) => r.dealStatus === "transacted" && r.ppm2 != null).map((r) => r.ppm2!);
  const a = quantile(asking, 0.5);
  const t = quantile(transacted, 0.5);
  if (a == null || t == null || a === 0) return null;
  return ((a - t) / a) * 100;
}

// ── area label derivation ───────────────────────────────────────────────────

/** Prefer a stored location name; otherwise pull a district-ish token from the address. */
export function areaLabel(locName: string | null, addressText: string | null): string | null {
  if (locName && locName.trim()) return locName.trim();
  if (!addressText) return null;
  const parts = addressText.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // a district token usually sits near the end, before the city; take the
  // second-to-last segment when present, else the last.
  return parts.length >= 2 ? parts[parts.length - 2]! : parts[parts.length - 1]!;
}

// ── DB load ─────────────────────────────────────────────────────────────────

export async function loadAnalytics(filters: AnalyticsFilters, now = new Date()): Promise<AnalyticsData> {
  const db = getDb();
  const raw = await db
    .select({
      ppm2: priceObservation.pricePerM2,
      listingType: priceObservation.listingType,
      dealStatus: priceObservation.dealStatus,
      observedAt: priceObservation.observedAt,
      createdAt: priceObservation.createdAt,
      propertyType: property.type,
      projectName: project.name,
      propertyProjectName: property.projectName,
      buildingName: building.name,
      propertyBuildingName: property.buildingName,
      addressText: property.addressText,
      locName: location.name,
    })
    .from(priceObservation)
    .innerJoin(property, eq(priceObservation.propertyId, property.id))
    .leftJoin(project, eq(property.projectId, project.id))
    .leftJoin(building, eq(property.buildingId, building.id))
    .leftJoin(location, eq(property.locationId, location.id))
    .where(and(eq(priceObservation.needsReview, false), isNotNull(priceObservation.propertyId)));

  const all: ObsRow[] = raw.map((r) => ({
    ppm2: r.ppm2 == null ? null : Number(r.ppm2),
    listingType: r.listingType,
    dealStatus: r.dealStatus,
    propertyType: r.propertyType ?? "unknown",
    projectName: r.projectName ?? r.propertyProjectName,
    buildingName: r.buildingName ?? r.propertyBuildingName,
    area: areaLabel(r.locName, r.addressText),
    at: r.observedAt ?? r.createdAt,
  }));

  const axis = monthAxis(filters.period, now);
  const cutoff = new Date(`${axis[0]!.key}-01T00:00:00Z`).getTime();
  const inWindow = all.filter((r) => r.at.getTime() >= cutoff);

  // filter options derived from what's actually in the window
  const typeCounts = new Map<string, number>();
  for (const r of inWindow) typeCounts.set(r.propertyType, (typeCounts.get(r.propertyType) ?? 0) + 1);
  const types = [...typeCounts.entries()]
    .map(([id, count]) => ({ id, label: typeLabel(id), count }))
    .sort((a, b) => b.count - a.count);
  const projects = [...new Set(inWindow.map((r) => r.projectName).filter((p): p is string => !!p))].sort();
  const buildings = [
    ...new Set(
      inWindow
        .filter((r) => filters.project === "all" || r.projectName === filters.project)
        .map((r) => r.buildingName)
        .filter((b): b is string => !!b),
    ),
  ].sort();

  // apply selected filters
  let rows = inWindow;
  if (filters.type !== "all") rows = rows.filter((r) => r.propertyType === filters.type);
  if (filters.project !== "all") rows = rows.filter((r) => r.projectName === filters.project);
  if (filters.building !== "all") rows = rows.filter((r) => r.buildingName === filters.building);
  const dealRows = filters.deal === "all" ? rows : rows.filter((r) => r.dealStatus === filters.deal);

  const options: FilterOptions = { types, projects, buildings };
  const activity: ActivityCol[] = monthlyTrend(dealRows, axis).map((p) => ({ label: p.label, value: p.volume }));
  const mode = filters.type === "all" ? "overview" : "deepdive";

  if (mode === "overview") {
    const segments = buildSegments(filters.deal === "all" ? rows : dealRows);
    const discounts = [...new Set(rows.map((r) => r.propertyType))]
      .map((t) => discountFor(rows.filter((r) => r.propertyType === t)))
      .filter((d): d is number => d != null);
    const avgDiscountPct = discounts.length ? discounts.reduce((a, b) => a + b, 0) / discounts.length : null;
    return {
      filters,
      options,
      mode,
      totalObs: rows.filter((r) => r.ppm2 != null).length,
      segments,
      underpowered: segments.filter((s) => s.underpowered).length,
      avgDiscountPct,
      trend: [],
      trendPct: null,
      discountPct: null,
      districts: [],
      histogram: null,
      activity,
    };
  }

  // deep-dive (single type)
  const trend = monthlyTrend(dealRows, axis);
  const askingPts = trend.map((p) => p.asking).filter((v): v is number => v != null);
  const firstA = askingPts[0];
  const lastA = askingPts[askingPts.length - 1];
  const trendPct = firstA != null && lastA != null && firstA !== 0 ? ((lastA - firstA) / firstA) * 100 : null;
  const districts = rankByArea(dealRows);
  const histogram = histogramBins(dealRows.map((r) => r.ppm2).filter((v): v is number => v != null));

  return {
    filters,
    options,
    mode,
    totalObs: dealRows.filter((r) => r.ppm2 != null).length,
    segments: [],
    underpowered: 0,
    avgDiscountPct: null,
    trend,
    trendPct,
    discountPct: discountFor(rows),
    districts,
    histogram,
    activity,
  };
}

/** Parse loosely-typed URL search params into validated filters. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): AnalyticsFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const deal = one(sp.deal);
  const periodRaw = Number(one(sp.period));
  const period: Period = periodRaw === 3 || periodRaw === 6 || periodRaw === 12 ? periodRaw : 12;
  return {
    type: one(sp.type) || "all",
    project: one(sp.project) || "all",
    building: one(sp.building) || "all",
    deal: deal === "asking" || deal === "transacted" ? deal : "all",
    period,
  };
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../_components/icon";
import type { AnalyticsFilters, FilterOptions } from "../../lib/analytics";

const TYPE_ICON: Record<string, string> = {
  all: "layers",
  apartment: "building-2",
  house: "home",
  villa: "building",
  land: "layers",
  project: "building",
  unknown: "home",
};

const DEALS: [AnalyticsFilters["deal"], string][] = [
  ["all", "All"],
  ["asking", "Asking"],
  ["transacted", "Closed"],
];

const PERIODS: [3 | 6 | 12, string][] = [
  [3, "3M"],
  [6, "6M"],
  [12, "12M"],
];

export function FilterBar({ filters, options }: { filters: AnalyticsFilters; options: FilterOptions }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function update(patch: Partial<AnalyticsFilters>) {
    const next = { ...filters, ...patch };
    // changing the project invalidates a building selection
    if (patch.project !== undefined && patch.building === undefined) next.building = "all";
    const sp = new URLSearchParams();
    if (next.type !== "all") sp.set("type", next.type);
    if (next.project !== "all") sp.set("project", next.project);
    if (next.building !== "all") sp.set("building", next.building);
    if (next.deal !== "all") sp.set("deal", next.deal);
    if (next.period !== 12) sp.set("period", String(next.period));
    const qs = sp.toString();
    start(() => router.push(qs ? `/analytics?${qs}` : "/analytics", { scroll: false }));
  }

  const typeChips = [{ id: "all", label: "All", count: 0 }, ...options.types];

  return (
    <div className="filter-bar" data-pending={pending ? "" : undefined}>
      <div className="fb-group fb-types">
        <span className="fb-lbl">Type</span>
        <div className="filter-chips">
          {typeChips.map((t) => (
            <button key={t.id} className={`fchip ${filters.type === t.id ? "on" : ""}`} onClick={() => update({ type: t.id, project: "all", building: "all" })}>
              <Icon name={TYPE_ICON[t.id] ?? "home"} size={14} className="fc-ico" />
              {t.label}
              {t.id !== "all" && <span className="fc-n">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="fb-right">
        <div className="fb-group">
          <span className="fb-lbl">Project</span>
          <select className="input fb-select" value={filters.project} onChange={(e) => update({ project: e.target.value })}>
            <option value="all">All projects</option>
            {options.projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="fb-group">
          <span className="fb-lbl">Building</span>
          <select
            className="input fb-select"
            value={filters.building}
            disabled={options.buildings.length === 0}
            onChange={(e) => update({ building: e.target.value })}
          >
            <option value="all">All buildings</option>
            {options.buildings.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div className="fb-group">
          <span className="fb-lbl">Deal</span>
          <div className="seg-ctrl">
            {DEALS.map(([id, l]) => (
              <button key={id} className={filters.deal === id ? "on" : ""} onClick={() => update({ deal: id })}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="fb-group">
          <span className="fb-lbl">Period</span>
          <div className="seg-ctrl">
            {PERIODS.map(([id, l]) => (
              <button key={id} className={filters.period === id ? "on" : ""} onClick={() => update({ period: id })}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

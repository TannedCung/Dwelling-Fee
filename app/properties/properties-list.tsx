"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PropertyListItem } from "../../lib/properties";
import { Icon } from "../_components/icon";

const MIN_SAMPLE = 5;

const TYPE_LABEL: Record<string, string> = {
  apartment: "Apartment",
  house: "House",
  project: "Project",
  land: "Land",
  unknown: "Unknown",
};

const TYPE_ICON: Record<string, string> = {
  apartment: "building-2",
  house: "home",
  project: "building",
  land: "layers",
  unknown: "building",
};

const TYPE_FILTERS = [
  { id: "all", label: "All", icon: "layers" },
  { id: "apartment", label: "Apartments", icon: "building-2" },
  { id: "house", label: "Houses", icon: "home" },
  { id: "project", label: "Projects", icon: "building" },
  { id: "land", label: "Land", icon: "layers" },
];

const SORTS = [
  { id: "obs", label: "Most observed" },
  { id: "recent", label: "Recently updated" },
  { id: "price", label: "Highest /m²" },
] as const;

type SortId = (typeof SORTS)[number]["id"];

const m = (n: number | null) => (n == null ? "—" : `${(n / 1_000_000).toFixed(1)}M`);

function propertyTitle(p: PropertyListItem): string {
  return [p.projectName, p.buildingName, p.houseNumber].filter(Boolean).join(" / ")
    || p.name
    || "(unnamed property)";
}

function searchText(p: PropertyListItem): string {
  return [
    p.name,
    p.projectName,
    p.buildingName,
    p.houseNumber,
    p.type,
    p.addressText,
    ...p.tags,
  ].filter(Boolean).join(" ").toLowerCase();
}

function relativeDate(value: Date | string | null): string {
  if (!value) return "no observations";
  const time = new Date(value).getTime();
  const days = Math.round((Date.now() - time) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function RangeMini({ p }: { p: PropertyListItem }) {
  const d = p.saleDistribution;
  if (d.min == null || d.max == null || d.p25 == null || d.p75 == null || d.median == null) {
    return (
      <div className="range-mini">
        <div className="rm-bar" />
        <div className="rm-scale"><span>no range</span><span>n={d.n}</span></div>
      </div>
    );
  }
  const span = d.max - d.min || 1;
  const pos = (v: number) => `${((v - d.min!) / span) * 100}%`;
  const width = `${((d.p75 - d.p25) / span) * 100}%`;
  return (
    <div className="range-mini">
      <div className="rm-bar">
        <div className="rm-iqr" style={{ left: pos(d.p25), width }} />
        <div className="rm-med" style={{ left: pos(d.median) }} />
      </div>
      <div className="rm-scale"><span>{m(d.min)}</span><span>{m(d.max)}</span></div>
    </div>
  );
}

export function PropertiesList({ rows }: { rows: PropertyListItem[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortId>("obs");
  const [type, setType] = useState("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((p) => type === "all" || p.type === type)
      .filter((p) => !needle || searchText(p).includes(needle))
      .sort((a, b) => {
        if (sort === "recent") return (new Date(b.lastSeen ?? 0).getTime()) - (new Date(a.lastSeen ?? 0).getTime());
        if (sort === "price") return (b.saleDistribution.median ?? -1) - (a.saleDistribution.median ?? -1);
        return b.obsCount - a.obsCount;
      });
  }, [q, rows, sort, type]);

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={17} />
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            placeholder="Search project, building, house number, tag, or address..."
          />
        </div>
        <div className="seg-ctrl" aria-label="Sort properties">
          {SORTS.map((s) => (
            <button key={s.id} type="button" className={sort === s.id ? "on" : ""} onClick={() => setSort(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-chips" style={{ marginBottom: 18 }}>
        {TYPE_FILTERS.map((f) => (
          <button key={f.id} type="button" className={`fchip ${type === f.id ? "on" : ""}`} onClick={() => setType(f.id)}>
            <Icon name={f.icon} size={14} className="fc-ico" />
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <Icon name="search" size={30} />
          No properties match the current filters.
        </div>
      ) : (
        <div className="prop-list">
          {filtered.map((p) => (
            <Link key={p.id} href={`/properties/${p.id}`} className="card interactive prop-card">
              <div className={`prop-ico ${p.type}`}>
                <Icon name={TYPE_ICON[p.type] ?? "building"} size={24} />
              </div>
              <div className="prop-main">
                <div className="prop-name">{propertyTitle(p)}</div>
                <div className="prop-addr">
                  <Icon name="map-pin" size={13} />
                  {p.addressText || [p.projectName, p.buildingName].filter(Boolean).join(", ") || "No address recorded"}
                </div>
                <div className="prop-tags">
                  <span className="chip">{p.obsCount} obs</span>
                  <span className="badge neutral">{TYPE_LABEL[p.type] ?? p.type}</span>
                  {p.saleDistribution.n > 0 && p.saleDistribution.n < MIN_SAMPLE && (
                    <span className="badge warning"><Icon name="triangle-alert" size={12} />underpowered</span>
                  )}
                  <span className="chip"><Icon name="clock" size={12} />{relativeDate(p.lastSeen)}</span>
                  {p.tags.slice(0, 3).map((tag) => <span key={tag} className="chip">{tag}</span>)}
                </div>
              </div>
              <div className="prop-metrics">
                <div className="prop-metric">
                  <span className="pm-val">{m(p.saleDistribution.median)}</span>
                  <span className="pm-lbl">median /m²</span>
                </div>
                <RangeMini p={p} />
                <span className="prop-chev"><Icon name="chevron-right" size={20} /></span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

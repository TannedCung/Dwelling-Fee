import { loadAnalytics, parseFilters, typeLabel, type AnalyticsData, type Segment } from "../../lib/analytics";
import { Icon } from "../_components/icon";
import { DatabaseError } from "../_components/notice";
import { describeError } from "../../lib/page-error";
import { MIN_SAMPLE } from "../../lib/stats";
import { FilterBar } from "./analytics-filters";
import { LineChart, RankedBars, Columns, Histogram, type LineSeries } from "../_components/analytics-charts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const m = (n: number | null) => (n == null ? "—" : `${(n / 1_000_000).toFixed(1)}M`);

const DEAL_COLOR: Record<string, string> = {
  asking: "var(--asking)",
  transacted: "var(--transacted)",
  unknown: "var(--ink-3)",
};

const TYPE_ICON: Record<string, string> = {
  apartment: "building-2",
  house: "home",
  villa: "building",
  land: "layers",
  project: "building",
  unknown: "home",
};

function Kpi({
  icon,
  label,
  value,
  unit,
  sub,
  accent,
  warn,
}: {
  icon: string;
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  accent?: boolean;
  warn?: boolean;
}) {
  const warnStyle = warn ? { color: "var(--warning)" } : undefined;
  return (
    <div className={`kpi ${accent ? "accent" : ""}`}>
      <div className="kpi-top" style={warnStyle}>
        <Icon name={icon} size={16} />
        <span className="kpi-lbl">{label}</span>
      </div>
      <div className="kpi-val" style={warnStyle}>
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function IqrRow({ segment, axis }: { segment: Segment; axis: { lo: number; hi: number } }) {
  const d = segment.dist;
  if (d.min == null || d.max == null || d.p25 == null || d.p75 == null || d.median == null) return null;
  const span = axis.hi - axis.lo || 1;
  const pos = (v: number) => `${((v - axis.lo) / span) * 100}%`;
  const width = (a: number, b: number) => `${((b - a) / span) * 100}%`;
  const color = DEAL_COLOR[segment.dealStatus] ?? "var(--ink-3)";
  return (
    <div className={`iqr-row ${segment.underpowered ? "under" : ""}`}>
      <div className="iqr-label">
        <span className="il-deal">
          <span className="dot" style={{ background: color }} />
          {segment.dealStatus}
        </span>
        <span className="il-n">
          n={d.n}
          {segment.underpowered && <Icon name="triangle-alert" size={12} style={{ color: "var(--warning)" }} />}
        </span>
      </div>
      <div className="iqr-track">
        <div className="iqr-band" style={{ left: pos(d.min), width: width(d.min, d.max) }}>
          <div className="whisker" />
        </div>
        <div className="iqr-cap" style={{ left: pos(d.min) }} />
        <div className="iqr-cap" style={{ left: pos(d.max) }} />
        <div className="iqr-box" style={{ left: pos(d.p25), width: width(d.p25, d.p75), background: color, opacity: 0.22 }} />
        <div className="iqr-box" style={{ left: pos(d.p25), width: width(d.p25, d.p75), boxShadow: `inset 0 0 0 1.5px ${color}` }} />
        <div className="iqr-median" style={{ left: pos(d.median), background: color }} />
        <div className="iqr-val" style={{ left: `calc(${pos(d.median)} + 8px)` }}>{m(d.median)}</div>
      </div>
    </div>
  );
}

function AnalyticsGroup({ propertyType, segments }: { propertyType: string; segments: Segment[] }) {
  const numeric = segments.filter((s) => s.dist.min != null && s.dist.max != null);
  if (numeric.length === 0) return null;
  const lo = Math.min(...numeric.map((s) => s.dist.min!));
  const hi = Math.max(...numeric.map((s) => s.dist.max!));
  const pad = (hi - lo || hi || 1) * 0.06;
  const axis = { lo: lo - pad, hi: hi + pad };
  const ticks = [axis.lo, (axis.lo + axis.hi) / 2, axis.hi];
  return (
    <div className="analytics-group">
      <div className="ag-head">
        <div className="ag-title">
          <span className="pico" style={{ background: "var(--sunken)", color: "var(--clay)" }}>
            <Icon name={TYPE_ICON[propertyType] ?? "building"} size={17} />
          </span>
          {typeLabel(propertyType)}
        </div>
        <span className="muted">{segments.reduce((sum, s) => sum + s.dist.n, 0)} observations</span>
      </div>
      <div className="iqr-axis">
        {ticks.map((t, i) => (
          <span key={i}>{m(Math.round(t))}</span>
        ))}
      </div>
      <div className="iqr-chart">
        {segments.map((s) => (
          <IqrRow key={`${s.propertyType}|${s.dealStatus}`} segment={s} axis={axis} />
        ))}
      </div>
    </div>
  );
}

function Delta({ pct }: { pct: number }) {
  const dir = pct > 0.2 ? "up" : pct < -0.2 ? "down" : "flat";
  return (
    <span className={`delta ${dir}`}>
      <Icon name={pct >= 0 ? "arrow-up" : "arrow-down"} size={13} />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function Overview({ data }: { data: AnalyticsData }) {
  const order = ["apartment", "house", "villa", "land", "project", "unknown"];
  const present = Array.from(new Set(data.segments.map((s) => s.propertyType)));
  const types = order.filter((t) => present.includes(t));
  return (
    <>
      <div className="kpi-grid section" style={{ marginTop: 4 }}>
        <Kpi accent icon="database" label="Observations" value={data.totalObs} sub={`across ${data.segments.length} segments`} />
        <Kpi
          icon="git-merge"
          label="Avg discount"
          value={data.avgDiscountPct == null ? "—" : `-${data.avgDiscountPct.toFixed(1)}`}
          unit={data.avgDiscountPct == null ? undefined : "%"}
          sub="asking → closed, all types"
        />
        <Kpi icon="layers" label="Types" value={types.length} sub={types.map(typeLabel).join(" · ") || "—"} />
        <Kpi icon="triangle-alert" label="Underpowered" value={data.underpowered} warn={data.underpowered > 0} sub={`segments n < ${MIN_SAMPLE}`} />
      </div>

      {data.underpowered > 0 && (
        <div className="notice section" style={{ marginTop: 18 }}>
          <Icon name="triangle-alert" size={17} />
          <span>
            {data.underpowered} segment{data.underpowered === 1 ? "" : "s"} with n &lt; {MIN_SAMPLE} — shown dimmed and treated as
            underpowered. Don&apos;t make decisions on them.
          </span>
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <h2>IQR comparison by segment</h2>
          <span className="muted">asking vs closed · never mixes types</span>
        </div>
        <div className="legend-bar" style={{ marginBottom: 16 }}>
          <span className="lb">
            <span className="swatch" style={{ background: "var(--asking)", opacity: 0.3, boxShadow: "inset 0 0 0 1.5px var(--asking)" }} />
            asking
          </span>
          <span className="lb">
            <span className="swatch" style={{ background: "var(--transacted)", opacity: 0.3, boxShadow: "inset 0 0 0 1.5px var(--transacted)" }} />
            transacted
          </span>
          <span className="lb">
            <span className="medline" />
            median
          </span>
          <span className="lb" style={{ color: "var(--ink-3)" }}>
            box = p25–p75 · whisker = min–max
          </span>
        </div>
        <div className="stack" style={{ gap: 14 }}>
          {types.map((t) => (
            <AnalyticsGroup key={t} propertyType={t} segments={data.segments.filter((s) => s.propertyType === t)} />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Market activity</h2>
          <span className="muted">observations / month · all types</span>
        </div>
        <div className="card chart-card">
          <Columns data={data.activity} color="var(--clay)" />
        </div>
      </section>
    </>
  );
}

function DeepDive({ data }: { data: AnalyticsData }) {
  const f = data.filters;
  const tLabel = typeLabel(f.type);
  const lastAsking = [...data.trend].reverse().find((p) => p.asking != null)?.asking ?? null;
  const lastTransacted = [...data.trend].reverse().find((p) => p.transacted != null)?.transacted ?? null;
  const headline = f.deal === "transacted" ? lastTransacted : lastAsking;

  const series: LineSeries[] = [];
  if (f.deal !== "transacted") series.push({ name: "Asking", color: "var(--asking)", points: data.trend.map((p) => p.asking), fill: true });
  if (f.deal !== "asking")
    series.push({ name: "Transacted", color: "var(--transacted)", points: data.trend.map((p) => p.transacted), fill: f.deal === "transacted" });

  const hasTrend = data.trend.some((p) => p.asking != null || p.transacted != null);

  return (
    <>
      <div className="kpi-grid section" style={{ marginTop: 4 }}>
        <Kpi
          accent
          icon="coins"
          label={`Median /m² · ${f.deal === "transacted" ? "closed" : "asking"}`}
          value={m(headline)}
          sub={
            data.trendPct == null ? (
              <span>over {f.period} months</span>
            ) : (
              <span>
                <Delta pct={data.trendPct} /> over {f.period} months
              </span>
            )
          }
        />
        <Kpi
          icon="git-merge"
          label="Closing discount"
          value={data.discountPct == null ? "—" : `-${data.discountPct.toFixed(1)}`}
          unit={data.discountPct == null ? undefined : "%"}
          sub="asking → transacted median"
        />
        <Kpi icon="database" label="Observations" value={data.totalObs} sub={`in the last ${f.period} months`} />
        <Kpi icon="map-pin" label="Areas" value={data.districts.length} sub={`${tLabel.toLowerCase()} · ${f.project === "all" ? "all projects" : f.project}`} />
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Price /m² over time — {tLabel}</h2>
          <span className="muted">{f.period} months</span>
        </div>
        <div className="card chart-card">
          {hasTrend ? (
            <>
              <LineChart series={series} xLabels={data.trend.map((p) => p.label)} />
              <div className="legend-bar" style={{ marginTop: 10 }}>
                {series.map((s, i) => (
                  <span key={i} className="lb">
                    <span className="medline" style={{ background: s.color, width: 14, height: 3 }} />
                    {s.name}
                  </span>
                ))}
                {f.deal === "all" && (
                  <span className="lb" style={{ color: "var(--ink-3)" }}>
                    gap between lines = negotiation discount
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="empty">No priced observations in this window.</div>
          )}
        </div>
      </section>

      <div className="chart-2col section">
        <div className="card chart-card">
          <div className="cc-head">
            <h3>Median by area</h3>
            <span className="muted mono">{tLabel}</span>
          </div>
          {data.districts.length === 0 ? (
            <div className="empty">No located observations yet.</div>
          ) : (
            <RankedBars rows={data.districts} />
          )}
        </div>
        <div className="card chart-card">
          <div className="cc-head">
            <h3>Price /m² distribution</h3>
            <span className="muted mono">dark bar = median</span>
          </div>
          {data.histogram ? (
            <>
              <Histogram dist={data.histogram} />
              <p className="muted" style={{ margin: "8px 2px 0", fontSize: 12 }}>
                Observations per price band (million ₫/m²).
              </p>
            </>
          ) : (
            <div className="empty">Not enough priced observations to plot a distribution.</div>
          )}
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Market activity</h2>
          <span className="muted">observations / month</span>
        </div>
        <div className="card chart-card">
          <Columns data={data.activity} />
        </div>
      </section>
    </>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);

  let data: AnalyticsData | null = null;
  let error: string | null = null;
  try {
    data = await loadAnalytics(filters);
  } catch (e) {
    error = describeError(e, "analytics");
  }

  return (
    <main>
      <header className="page-head">
        <div className="eyebrow">
          <Icon name="trending-up" size={13} /> Analytics
        </div>
        <h1>Market analytics</h1>
        <p>
          Price/m² distributions and trends, split by type and deal status — never mixed. Pick a type for an apples-to-apples
          deep-dive; small samples are always flagged.
        </p>
      </header>

      {error ? (
        <DatabaseError detail={error} />
      ) : data ? (
        <div className="stack" style={{ gap: 18 }}>
          <FilterBar filters={data.filters} options={data.options} />
          {data.totalObs === 0 ? (
            <div className="empty">No resolved observations with a price/m² match these filters yet.</div>
          ) : data.mode === "overview" ? (
            <Overview data={data} />
          ) : (
            <DeepDive data={data} />
          )}
        </div>
      ) : null}
    </main>
  );
}

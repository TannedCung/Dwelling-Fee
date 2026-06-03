import { segmentStats, type Segment } from "../../lib/analytics";
import { Icon } from "../_components/icon";
import { DatabaseError } from "../_components/notice";
import { describeError } from "../../lib/page-error";
import { MIN_SAMPLE } from "../../lib/stats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const m = (n: number | null) => (n == null ? "—" : `${(n / 1_000_000).toFixed(1)}M`);

const DEAL_COLOR: Record<string, string> = {
  asking: "var(--asking)",
  transacted: "var(--transacted)",
  unknown: "var(--ink-3)",
};

function listingLabel(value: string) {
  if (value === "sale") return "Sale";
  if (value === "rent") return "Rent";
  return value;
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

function AnalyticsGroup({ listingType, segments }: { listingType: string; segments: Segment[] }) {
  const numeric = segments.filter((s) => s.dist.min != null && s.dist.max != null);
  const lo = Math.min(...numeric.map((s) => s.dist.min!));
  const hi = Math.max(...numeric.map((s) => s.dist.max!));
  const pad = (hi - lo || hi || 1) * 0.06;
  const axis = { lo: lo - pad, hi: hi + pad };
  const ticks = [axis.lo, (axis.lo + axis.hi) / 2, axis.hi];
  return (
    <div className="analytics-group">
      <div className="ag-head">
        <div className="ag-title">
          <span className="pico"><Icon name={listingType === "rent" ? "home" : "building-2"} size={17} /></span>
          {listingLabel(listingType)}
        </div>
        <span className="muted">{segments.reduce((sum, s) => sum + s.dist.n, 0)} observations</span>
      </div>
      <div className="iqr-axis">
        {ticks.map((t, i) => <span key={i}>{m(Math.round(t))}</span>)}
      </div>
      <div className="iqr-chart">
        {segments.map((s) => <IqrRow key={`${s.listingType}|${s.dealStatus}`} segment={s} axis={axis} />)}
      </div>
    </div>
  );
}

export default async function AnalyticsPage() {
  let segments: Segment[] = [];
  let error: string | null = null;
  try {
    segments = await segmentStats();
  } catch (e) {
    error = describeError(e, "analytics");
  }

  const underpowered = segments.filter((s) => s.underpowered).length;
  const totalObs = segments.reduce((sum, s) => sum + s.dist.n, 0);
  const askingObs = segments.filter((s) => s.dealStatus === "asking").reduce((sum, s) => sum + s.dist.n, 0);
  const transactedObs = segments.filter((s) => s.dealStatus === "transacted").reduce((sum, s) => sum + s.dist.n, 0);
  const listingTypes = Array.from(new Set(segments.map((s) => s.listingType)));

  return (
    <main>
      <header className="page-head">
        <div className="eyebrow">Analytics</div>
        <h1>Analytics</h1>
        <p>
          Price/m² distributions, segmented by listing type and deal status — never mixed. Segments with
          n &lt; 5 are flagged as underpowered.
        </p>
      </header>

      {error ? (
        <DatabaseError detail={error} />
      ) : segments.length === 0 ? (
        <div className="empty">No resolved observations with a price/m² yet.</div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="kpi-grid">
            <div className="kpi accent">
              <div className="kpi-top"><Icon name="database" size={16} /><span className="kpi-lbl">Observations</span></div>
              <div className="kpi-val">{totalObs}</div>
              <div className="kpi-sub">across {segments.length} segments</div>
            </div>
            <div className="kpi">
              <div className="kpi-top"><Icon name="building" size={16} /><span className="kpi-lbl">Listing types</span></div>
              <div className="kpi-val">{listingTypes.length}</div>
              <div className="kpi-sub">{listingTypes.map(listingLabel).join(" · ")}</div>
            </div>
            <div className="kpi">
              <div className="kpi-top"><Icon name="git-merge" size={16} /><span className="kpi-lbl">Asking vs closed</span></div>
              <div className="kpi-val">{askingObs}<span className="unit">/ {transactedObs}</span></div>
              <div className="kpi-sub">asking / transacted observations</div>
            </div>
            <div className="kpi">
              <div className="kpi-top" style={{ color: underpowered ? "var(--warning)" : "var(--ink-3)" }}>
                <Icon name="triangle-alert" size={16} /><span className="kpi-lbl">Underpowered</span>
              </div>
              <div className="kpi-val" style={{ color: underpowered ? "var(--warning)" : "var(--ink)" }}>{underpowered}</div>
              <div className="kpi-sub">segments with n &lt; {MIN_SAMPLE}</div>
            </div>
          </div>

          {underpowered > 0 && (
            <div className="notice">
              <Icon name="triangle-alert" size={17} />
              <span>
                {underpowered} segment{underpowered === 1 ? "" : "s"} with n &lt; 5 — shown dimmed and
                treated as underpowered.
              </span>
            </div>
          )}

          <section className="section" style={{ marginTop: 6 }}>
            <div className="section-head">
              <h2>IQR comparison by segment</h2>
              <span className="muted">box = p25–p75 · whisker = min–max · line = median</span>
            </div>
            <div className="legend-bar">
              <span className="lb"><span className="swatch" style={{ background: "var(--asking)", opacity: 0.3, boxShadow: "inset 0 0 0 1.5px var(--asking)" }} />asking</span>
              <span className="lb"><span className="swatch" style={{ background: "var(--transacted)", opacity: 0.3, boxShadow: "inset 0 0 0 1.5px var(--transacted)" }} />transacted</span>
              <span className="lb"><span className="medline" />median</span>
            </div>
            <div className="stack" style={{ gap: 14 }}>
              {listingTypes.map((listingType) => (
                <AnalyticsGroup
                  key={listingType}
                  listingType={listingType}
                  segments={segments.filter((s) => s.listingType === listingType)}
                />
              ))}
            </div>
          </section>

          <div className="card table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">Listing</th>
                  <th className="l">Deal</th>
                  <th>n</th>
                  <th>median /m²</th>
                  <th>p25</th>
                  <th>p75</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s) => (
                  <tr key={`${s.listingType}|${s.dealStatus}`} className={s.underpowered ? "under" : undefined}>
                    <td className="l seg">{s.listingType}</td>
                    <td className="l seg">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {s.dealStatus}
                        {s.underpowered && <Icon name="triangle-alert" size={13} style={{ color: "var(--warning)" }} />}
                      </span>
                    </td>
                    <td>{s.dist.n}</td>
                    <td>{m(s.dist.median)}</td>
                    <td>{m(s.dist.p25)}</td>
                    <td>{m(s.dist.p75)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

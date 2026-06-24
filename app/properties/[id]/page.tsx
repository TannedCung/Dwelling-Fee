import Link from "next/link";
import { notFound } from "next/navigation";
import { getProperty, type PropertyDetail } from "../../../lib/properties";
import { PriceScatter } from "../../_components/price-scatter";
import { MIN_SAMPLE } from "../../../lib/stats";
import { Icon } from "../../_components/icon";
import { DatabaseError } from "../../_components/notice";
import { describeError } from "../../../lib/page-error";
import { sourceHostLabel } from "../../../lib/source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const m = (n: number | null) => (n == null ? "—" : `${(n / 1_000_000).toFixed(1)}M`);

const SOURCE_LABEL: Record<string, string> = {
  broker: "Broker",
  web: "Web",
  agent: "Agent",
  user: "User",
};

const SOURCE_COLOR: Record<string, string> = {
  broker: "var(--viz-broker)",
  web: "var(--viz-web)",
  agent: "var(--viz-agent)",
  user: "var(--viz-user)",
};

function propertyTitle(detail: PropertyDetail): string {
  return [detail.projectName, detail.buildingName, detail.houseNumber].filter(Boolean).join(" / ")
    || detail.name
    || "(unnamed property)";
}

function SourceChip({ source }: { source: string }) {
  return (
    <span className={`src-chip src-${source}`}>
      <span className="dot" style={{ background: SOURCE_COLOR[source] ?? "var(--ink-3)" }} />
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}

function SourceCell({ sourceType, sourceUrl }: { sourceType: string; sourceUrl: string | null }) {
  return (
    <div style={{ display: "grid", gap: 4, justifyItems: "start" }}>
      <SourceChip source={sourceType} />
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12 }}>
          {sourceHostLabel(sourceUrl)}
        </a>
      )}
    </div>
  );
}

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail;
  try {
    detail = await getProperty(id);
  } catch (e) {
    return <DatabaseError detail={describeError(e, "property.detail")} />;
  }
  if (!detail) notFound();

  const d = detail.saleDistribution;
  const reliable = d.n >= MIN_SAMPLE;
  const sourceCounts = detail.observations.reduce<Record<string, number>>((acc, o) => {
    acc[o.sourceType] = (acc[o.sourceType] ?? 0) + 1;
    return acc;
  }, {});
  const totalSources = Object.values(sourceCounts).reduce((sum, n) => sum + n, 0);
  const relLevel = d.n >= 10 ? 4 : d.n >= 7 ? 3 : d.n >= MIN_SAMPLE ? 2 : Math.min(1, d.n);

  return (
    <main>
      <Link href="/properties" className="back-link" style={{ marginBottom: 16 }}>
        <Icon name="arrow-left" size={15} /> Properties
      </Link>
      <header className="page-head">
        <div className="eyebrow">Living page</div>
        <h1>{propertyTitle(detail)}</h1>
        <p>
          {detail.type}
          {detail.tags.length > 0 && ` · ${detail.tags.join(", ")}`}
          {detail.addressText && ` · ${detail.addressText}`} · {detail.observations.length} observations
        </p>
        {(detail.projectId || detail.buildingId) && (
          <div className="prop-tags" style={{ marginTop: 12 }}>
            {detail.projectId && (
              <Link href={`/projects/${detail.projectId}`} className="chip">
                <Icon name="building-2" size={12} />{detail.projectName}
              </Link>
            )}
            {detail.buildingId && (
              <Link href={`/buildings/${detail.buildingId}`} className="chip">
                <Icon name="building" size={12} />{detail.buildingName}
              </Link>
            )}
          </div>
        )}
      </header>

      <section className="detail-hero section" style={{ marginTop: 0 }}>
        <div className="hero-stat">
          <div className="hs-lbl">Sale price / m² median</div>
          <div className="hs-big">{m(d.median)}<span className="unit">VND</span></div>
          <div className="hs-meta">
            <div className="stat">
              <span className="num" style={{ fontSize: 18 }}>{m(d.p25)}–{m(d.p75)}</span>
              <span className="lbl">IQR p25–p75</span>
            </div>
            <div className="stat">
              <span className="num" style={{ fontSize: 18 }}>n={d.n}</span>
              <span className="lbl">sale sample size</span>
            </div>
            <div className="stat">
              <span className="num" style={{ fontSize: 18 }}>{detail.observations.length}</span>
              <span className="lbl">total observations</span>
            </div>
          </div>
        </div>

        <div className="hero-side">
          <div className="mini-stat">
            <span className="ms-l"><Icon name="check-circle" size={16} />Reliability</span>
            <span className="reliability">
              <span className="rel-dots">
                {[0, 1, 2, 3].map((i) => <i key={i} className={i < relLevel ? (reliable ? "on" : "warn") : ""} />)}
              </span>
              <span className="ms-v" style={{ fontSize: 13, color: reliable ? "var(--success)" : "var(--warning)" }}>
                {reliable ? "Enough sample" : "Underpowered"}
              </span>
            </span>
          </div>
          <div className="mini-stat" style={{ display: "block" }}>
            <span className="ms-l" style={{ marginBottom: 12 }}>
              <Icon name="database" size={16} />Observation sources
            </span>
            {totalSources === 0 ? (
              <div className="muted">No source data yet.</div>
            ) : (
              <div className="src-break">
                {Object.entries(sourceCounts).map(([source, n]) => (
                  <div key={source} className="src-row">
                    <span className="sr-lbl">
                      <span className="dot" style={{ background: SOURCE_COLOR[source] ?? "var(--ink-3)" }} />
                      {SOURCE_LABEL[source] ?? source}
                    </span>
                    <span className="sr-track">
                      <span className="sr-fill" style={{ width: `${(n / totalSources) * 100}%`, background: SOURCE_COLOR[source] ?? "var(--ink-3)" }} />
                    </span>
                    <span className="sr-n">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {!reliable && (
        <div className="notice section" style={{ marginTop: 18 }}>
          <Icon name="triangle-alert" size={17} />
          <span>
            Only {d.n} sale observation(s) — too few for a reliable estimate (need ≥ {MIN_SAMPLE}). Treat the range as directional only.
          </span>
        </div>
      )}

      <div className="section" style={{ marginTop: 18 }}>
        <div className="section-head">
          <h2>Price/m² over time</h2>
        </div>
        <PriceScatter
          points={detail.observations
            .filter((o) => !o.needsReview)
            .map((o) => ({
              t: o.t,
              pricePerM2: o.pricePerM2,
              sourceType: o.sourceType,
              dealStatus: o.dealStatus,
            }))}
          band={{ median: d.median, p25: d.p25, p75: d.p75 }}
        />
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Observations</h2>
          <span className="muted">Append-only facts with source and confidence</span>
        </div>
        {detail.observations.length === 0 ? (
          <div className="empty">No observations linked to this property.</div>
        ) : (
          <div className="table-wrap">
            <table className="data" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th className="l">Date</th>
                  <th className="l">Project</th>
                  <th className="l">Building</th>
                  <th className="l">Listing</th>
                  <th className="l">Deal</th>
                  <th>Price</th>
                  <th>Area</th>
                  <th>Price/m²</th>
                  <th className="l">Source</th>
                  <th>Conf.</th>
                </tr>
              </thead>
              <tbody>
                {detail.observations.map((o) => (
                  <tr key={o.id}>
                    <td className="l seg">{new Date(o.t).toLocaleDateString()}</td>
                    <td className="l seg">{o.projectName ?? "—"}</td>
                    <td className="l seg">{o.buildingName ?? "—"}</td>
                    <td className="l seg">{o.listingType}</td>
                    <td className="l seg">
                      <span className={`badge ${o.dealStatus === "transacted" ? "transacted" : o.dealStatus === "asking" ? "asking" : "neutral"}`} style={{ padding: "2px 9px" }}>
                        {o.dealStatus}
                      </span>
                    </td>
                    <td>{o.priceVnd == null ? "—" : m(o.priceVnd)}</td>
                    <td>{o.areaM2 == null ? "—" : `${o.areaM2} m²`}</td>
                    <td>{m(o.pricePerM2)}</td>
                    <td className="l seg"><SourceCell sourceType={o.sourceType} sourceUrl={o.sourceUrl} /></td>
                    <td>{o.confidence == null ? "—" : `${(o.confidence * 100).toFixed(0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

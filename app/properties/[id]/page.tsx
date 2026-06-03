import Link from "next/link";
import { notFound } from "next/navigation";
import { getProperty } from "../../../lib/properties";
import { PriceScatter } from "../../_components/price-scatter";
import { MIN_SAMPLE } from "../../../lib/stats";
import { Icon } from "../../_components/icon";
import { DatabaseError } from "../../_components/notice";
import { describeError } from "../../../lib/page-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const m = (n: number | null) => (n == null ? "—" : `${(n / 1_000_000).toFixed(1)}M`);

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

  return (
    <main>
      <Link href="/properties" className="back-link" style={{ marginBottom: 16 }}>
        <Icon name="arrow-left" size={15} /> Properties
      </Link>
      <header className="page-head">
        <div className="eyebrow">Living page</div>
        <h1>{detail.name ?? "(unnamed property)"}</h1>
        <p>
          {detail.type}
          {detail.addressText && ` · ${detail.addressText}`} · {detail.observations.length} observations
        </p>
      </header>

      <section className="section" style={{ marginTop: 0 }}>
        <h2>Sale price/m² distribution</h2>
        {!reliable ? (
          <div className="notice">
            <Icon name="triangle-alert" size={17} />
            <span>
              Only {d.n} sale observation(s) — too few for a reliable estimate (need ≥ {MIN_SAMPLE}).
            </span>
          </div>
        ) : (
          <div className="stat-row">
            <div className="stat">
              <span className="num">{m(d.median)}</span>
              <span className="lbl">median /m²</span>
            </div>
            <div className="stat">
              <span className="num">{m(d.p25)}–{m(d.p75)}</span>
              <span className="lbl">IQR p25–p75</span>
            </div>
            <div className="stat">
              <span className="num">n={d.n}</span>
              <span className="lbl">sample size</span>
            </div>
          </div>
        )}
      </section>

      <div className="section" style={{ marginTop: 18 }}>
        <PriceScatter
          points={detail.observations.map((o) => ({
            t: o.t,
            pricePerM2: o.pricePerM2,
            sourceType: o.sourceType,
            dealStatus: o.dealStatus,
          }))}
          band={{ median: d.median, p25: d.p25, p75: d.p75 }}
        />
      </div>

      <section className="section">
        <h2>Observations</h2>
        {detail.observations.length === 0 ? (
          <div className="empty">No observations linked to this property.</div>
        ) : (
          <div className="table-wrap">
            <table className="data" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th className="l">Date</th>
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
                    <td className="l seg">{o.listingType}</td>
                    <td className="l seg">{o.dealStatus}</td>
                    <td>{o.priceVnd == null ? "—" : m(o.priceVnd)}</td>
                    <td>{o.areaM2 == null ? "—" : `${o.areaM2} m²`}</td>
                    <td>{m(o.pricePerM2)}</td>
                    <td className="l seg">{o.sourceType}</td>
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

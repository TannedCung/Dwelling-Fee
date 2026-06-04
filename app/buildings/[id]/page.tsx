import Link from "next/link";
import { notFound } from "next/navigation";
import { getBuilding } from "../../../lib/properties";
import { DatabaseError } from "../../_components/notice";
import { describeError } from "../../../lib/page-error";
import { Icon } from "../../_components/icon";
import { PropertiesList } from "../../properties/properties-list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const m = (n: number | null) => (n == null ? "--" : `${(n / 1_000_000).toFixed(1)}M`);

export default async function BuildingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail;
  try {
    detail = await getBuilding(id);
  } catch (e) {
    return <DatabaseError detail={describeError(e, "building.detail")} />;
  }
  if (!detail) notFound();

  const d = detail.saleDistribution;
  return (
    <main>
      <Link href={`/projects/${detail.projectId}`} className="back-link" style={{ marginBottom: 16 }}>
        <Icon name="arrow-left" size={15} /> {detail.projectName}
      </Link>
      <header className="page-head">
        <div className="eyebrow">Building wiki</div>
        <h1>{detail.projectName} / {detail.name}</h1>
        <p>
          {detail.addressText || "No address recorded"} · {detail.propertyCount} properties · {detail.obsCount} observations
        </p>
      </header>

      <section className="detail-hero section" style={{ marginTop: 0 }}>
        <div className="hero-stat">
          <div className="hs-lbl">Sale price / m2 median</div>
          <div className="hs-big">{m(d.median)}<span className="unit">VND</span></div>
          <div className="hs-meta">
            <div className="stat">
              <span className="num" style={{ fontSize: 18 }}>{m(d.p25)}-{m(d.p75)}</span>
              <span className="lbl">IQR p25-p75</span>
            </div>
            <div className="stat">
              <span className="num" style={{ fontSize: 18 }}>n={d.n}</span>
              <span className="lbl">sale sample size</span>
            </div>
            <div className="stat">
              <span className="num" style={{ fontSize: 18 }}>{detail.obsCount}</span>
              <span className="lbl">total observations</span>
            </div>
          </div>
        </div>
        <div className="hero-side">
          <Link href={`/projects/${detail.projectId}`} className="mini-stat interactive">
            <span className="ms-l"><Icon name="building" size={16} />Project</span>
            <span className="ms-v" style={{ fontSize: 14 }}>{detail.projectName}</span>
          </Link>
          <div className="mini-stat">
            <span className="ms-l"><Icon name="home" size={16} />Properties</span>
            <span className="ms-v">{detail.propertyCount}</span>
          </div>
        </div>
      </section>

      {(detail.wikiNotes || detail.aiSummary) && (
        <section className="section">
          <div className="section-head"><h2>Wiki notes</h2></div>
          <p className="raw">{detail.wikiNotes || detail.aiSummary}</p>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Properties</h2>
          <span className="muted">Specific units, houses, or lots in this building</span>
        </div>
        {detail.properties.length === 0 ? <div className="empty">No properties linked yet.</div> : <PropertiesList rows={detail.properties} />}
      </section>
    </main>
  );
}

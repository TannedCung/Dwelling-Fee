import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, type BuildingListItem } from "../../../lib/properties";
import { DatabaseError } from "../../_components/notice";
import { describeError } from "../../../lib/page-error";
import { Icon } from "../../_components/icon";
import { MIN_SAMPLE } from "../../../lib/stats";
import { PropertiesList } from "../../properties/properties-list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const m = (n: number | null) => (n == null ? "--" : `${(n / 1_000_000).toFixed(1)}M`);

function BuildingCard({ b }: { b: BuildingListItem }) {
  return (
    <Link href={`/buildings/${b.id}`} className="card interactive">
      <div className="section-head" style={{ alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 16 }}>{b.name}</h3>
          <p className="muted" style={{ marginTop: 4 }}>{b.addressText || b.projectName}</p>
        </div>
        <Icon name="chevron-right" size={20} />
      </div>
      <div className="prop-tags">
        <span className="chip">{b.propertyCount} properties</span>
        <span className="chip">{b.obsCount} obs</span>
        {b.saleDistribution.n > 0 && b.saleDistribution.n < MIN_SAMPLE && (
          <span className="badge warning"><Icon name="triangle-alert" size={12} />underpowered</span>
        )}
      </div>
      <div className="mini-stat" style={{ marginTop: 14 }}>
        <span className="ms-l"><Icon name="trending-up" size={16} />Sale median /m2</span>
        <span className="ms-v">{m(b.saleDistribution.median)}</span>
      </div>
    </Link>
  );
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail;
  try {
    detail = await getProject(id);
  } catch (e) {
    return <DatabaseError detail={describeError(e, "project.detail")} />;
  }
  if (!detail) notFound();

  const d = detail.saleDistribution;
  return (
    <main>
      <Link href="/projects" className="back-link" style={{ marginBottom: 16 }}>
        <Icon name="arrow-left" size={15} /> Projects
      </Link>
      <header className="page-head">
        <div className="eyebrow">Project wiki</div>
        <h1>{detail.name}</h1>
        <p>
          {detail.addressText || "No address recorded"} · {detail.buildingCount} buildings · {detail.propertyCount} properties · {detail.obsCount} observations
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
          <div className="mini-stat">
            <span className="ms-l"><Icon name="building-2" size={16} />Buildings</span>
            <span className="ms-v">{detail.buildingCount}</span>
          </div>
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
          <h2>Buildings</h2>
          <span className="muted">Project children</span>
        </div>
        {detail.buildings.length === 0 ? (
          <div className="empty">No buildings have been grounded for this project.</div>
        ) : (
          <div className="card-grid">
            {detail.buildings.map((b) => <BuildingCard key={b.id} b={b} />)}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Properties</h2>
          <span className="muted">Specific units, houses, or lots in this project</span>
        </div>
        {detail.properties.length === 0 ? <div className="empty">No properties linked yet.</div> : <PropertiesList rows={detail.properties} />}
      </section>
    </main>
  );
}

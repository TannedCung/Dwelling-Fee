import Link from "next/link";
import { listProjects, type ProjectListItem } from "../../lib/properties";
import { DatabaseError } from "../_components/notice";
import { describeError } from "../../lib/page-error";
import { Icon } from "../_components/icon";
import { MIN_SAMPLE } from "../../lib/stats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const m = (n: number | null) => (n == null ? "--" : `${(n / 1_000_000).toFixed(1)}M`);

function ProjectCard({ p }: { p: ProjectListItem }) {
  return (
    <Link href={`/projects/${p.id}`} className="card interactive">
      <div className="section-head" style={{ alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 18 }}>{p.name}</h2>
          <p className="muted" style={{ marginTop: 4 }}>{p.addressText || "No address recorded"}</p>
        </div>
        <Icon name="chevron-right" size={20} />
      </div>
      <div className="prop-tags">
        <span className="chip">{p.buildingCount} buildings</span>
        <span className="chip">{p.propertyCount} properties</span>
        <span className="chip">{p.obsCount} obs</span>
        {p.saleDistribution.n > 0 && p.saleDistribution.n < MIN_SAMPLE && (
          <span className="badge warning"><Icon name="triangle-alert" size={12} />underpowered</span>
        )}
        {p.tags.slice(0, 3).map((tag) => <span key={tag} className="chip">{tag}</span>)}
      </div>
      <div className="mini-stat" style={{ marginTop: 14 }}>
        <span className="ms-l"><Icon name="trending-up" size={16} />Sale median /m2</span>
        <span className="ms-v">{m(p.saleDistribution.median)}</span>
      </div>
    </Link>
  );
}

export default async function ProjectsPage() {
  let rows: ProjectListItem[] = [];
  let error: string | null = null;
  try {
    rows = await listProjects();
  } catch (e) {
    error = describeError(e, "projects");
  }

  return (
    <main>
      <header className="page-head">
        <div className="eyebrow">Projects</div>
        <h1>Projects</h1>
        <p>Project wiki pages aggregate child buildings, properties, observations, and grounded notes.</p>
      </header>

      {error ? (
        <DatabaseError detail={error} />
      ) : rows.length === 0 ? (
        <div className="empty">No projects yet -- ingest or review signals with project names.</div>
      ) : (
        <div className="card-grid">
          {rows.map((p) => <ProjectCard key={p.id} p={p} />)}
        </div>
      )}
    </main>
  );
}

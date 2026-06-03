import Link from "next/link";
import { listProperties, type PropertyListItem } from "../../lib/properties";
import { DatabaseError } from "../_components/notice";
import { describeError } from "../../lib/page-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PropertiesPage() {
  let rows: PropertyListItem[] = [];
  let error: string | null = null;
  try {
    rows = await listProperties();
  } catch (e) {
    error = describeError(e, "properties");
  }

  return (
    <main>
      <header className="page-head">
        <div className="eyebrow">Properties</div>
        <h1>Properties</h1>
        <p>Resolved property entities — living pages that aggregate observations over time, most-observed first.</p>
      </header>

      {error ? (
        <DatabaseError detail={error} />
      ) : rows.length === 0 ? (
        <div className="empty">No properties yet — ingest some signals.</div>
      ) : (
        <div className="stack">
          {rows.map((p) => (
            <Link key={p.id} href={`/properties/${p.id}`} className="card interactive">
              <div className="card-row">
                <span className="card-title">{p.name ?? "(unnamed property)"}</span>
                <span className="chip">{p.obsCount} obs</span>
              </div>
              <div className="card-sub">
                {p.type}
                {p.addressText && ` · ${p.addressText}`}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

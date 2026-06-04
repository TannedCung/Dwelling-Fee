import { listProperties, type PropertyListItem } from "../../lib/properties";
import { DatabaseError } from "../_components/notice";
import { describeError } from "../../lib/page-error";
import { PropertiesList } from "./properties-list";

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
        <p>Resolved unit, house, and lot entities — living pages that aggregate observations over time, most-observed first.</p>
      </header>

      {error ? (
        <DatabaseError detail={error} />
      ) : rows.length === 0 ? (
        <div className="empty">No properties yet — ingest some signals.</div>
      ) : (
        <PropertiesList rows={rows} />
      )}
    </main>
  );
}

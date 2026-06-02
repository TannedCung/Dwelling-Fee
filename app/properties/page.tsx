import Link from "next/link";
import { listProperties, type PropertyListItem } from "../../lib/properties";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PropertiesPage() {
  let rows: PropertyListItem[] = [];
  let error: string | null = null;
  try {
    rows = await listProperties();
  } catch (e) {
    error = e instanceof Error ? e.message : "database unavailable";
  }

  return (
    <main style={{ display: "grid", gap: 16 }}>
      <header>
        <h1 style={{ marginBottom: 4 }}>Properties</h1>
        <p style={{ color: "#666", margin: 0 }}>Resolved property entities, most-observed first.</p>
      </header>

      {error ? (
        <p style={{ color: "#b00" }}>Database not reachable ({error}).</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "#888" }}>No properties yet — ingest some signals.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {rows.map((p) => (
            <li key={p.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
              <Link href={`/properties/${p.id}`} style={{ fontWeight: 600 }}>
                {p.name ?? "(unnamed property)"}
              </Link>
              <div style={{ fontSize: 13, color: "#888" }}>
                {p.type}
                {p.addressText && ` · ${p.addressText}`} · {p.obsCount} obs
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

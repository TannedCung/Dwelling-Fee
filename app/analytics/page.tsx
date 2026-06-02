import type { CSSProperties } from "react";
import { segmentStats, type Segment } from "../../lib/analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const m = (n: number | null) => (n == null ? "—" : `${(n / 1_000_000).toFixed(1)}M`);
const td: CSSProperties = { padding: "6px 10px", borderBottom: "1px solid #eee", textAlign: "right" };
const tdL: CSSProperties = { ...td, textAlign: "left" };

export default async function AnalyticsPage() {
  let segments: Segment[] = [];
  let error: string | null = null;
  try {
    segments = await segmentStats();
  } catch (e) {
    error = e instanceof Error ? e.message : "database unavailable";
  }

  return (
    <main style={{ display: "grid", gap: 16 }}>
      <header>
        <h1 style={{ marginBottom: 4 }}>Analytics</h1>
        <p style={{ color: "#666", margin: 0 }}>
          Price/m² distributions, segmented by listing type and deal status — never mixed (design §7).
          Segments with n &lt; 5 are flagged as underpowered.
        </p>
      </header>

      {error ? (
        <p style={{ color: "#b00" }}>Database not reachable ({error}).</p>
      ) : segments.length === 0 ? (
        <p style={{ color: "#888" }}>No resolved observations with a price/m² yet.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={tdL}>Listing</th>
              <th style={tdL}>Deal</th>
              <th style={td}>n</th>
              <th style={td}>median /m²</th>
              <th style={td}>p25</th>
              <th style={td}>p75</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s) => (
              <tr key={`${s.listingType}|${s.dealStatus}`} style={{ opacity: s.underpowered ? 0.55 : 1 }}>
                <td style={tdL}>{s.listingType}</td>
                <td style={tdL}>{s.dealStatus}{s.underpowered && " ⚠️"}</td>
                <td style={td}>{s.dist.n}</td>
                <td style={td}>{m(s.dist.median)}</td>
                <td style={td}>{m(s.dist.p25)}</td>
                <td style={td}>{m(s.dist.p75)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

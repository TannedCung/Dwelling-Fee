import { segmentStats, type Segment } from "../../lib/analytics";
import { Icon } from "../_components/icon";
import { DatabaseError } from "../_components/notice";
import { describeError } from "../../lib/page-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const m = (n: number | null) => (n == null ? "—" : `${(n / 1_000_000).toFixed(1)}M`);

export default async function AnalyticsPage() {
  let segments: Segment[] = [];
  let error: string | null = null;
  try {
    segments = await segmentStats();
  } catch (e) {
    error = describeError(e, "analytics");
  }

  const underpowered = segments.filter((s) => s.underpowered).length;

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
          {underpowered > 0 && (
            <div className="notice">
              <Icon name="triangle-alert" size={17} />
              <span>
                {underpowered} segment{underpowered === 1 ? "" : "s"} with n &lt; 5 — shown dimmed and
                treated as underpowered.
              </span>
            </div>
          )}
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

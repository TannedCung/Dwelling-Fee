import { listSources, recentRuns, type SourceView, type RunView } from "../../lib/collection";
import { AddSourceForm, RunButton, EnableToggle, PreviewButton } from "./collect-actions";
import { Icon } from "../_components/icon";
import { DatabaseError } from "../_components/notice";
import { describeError } from "../../lib/page-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function StatusBadge({ status }: { status: "ok" | "error" | null }) {
  if (!status) return <span className="badge neutral">never run</span>;
  return (
    <span className={`badge ${status === "ok" ? "committed" : "failed"}`}>
      <Icon name={status === "ok" ? "check-circle" : "triangle-alert"} size={13} />
      {status}
    </span>
  );
}

const when = (d: Date | null) => (d ? new Date(d).toLocaleString() : "—");

function sourceConfigSummary(source: SourceView) {
  const config = source.config && typeof source.config === "object" && !Array.isArray(source.config) ? source.config as Record<string, unknown> : {};
  if (source.kind === "stub") return "deterministic sample data";
  const parts = [
    `${typeof config.maxPages === "number" ? config.maxPages : 10} max pages`,
    `${typeof config.maxDepth === "number" ? config.maxDepth : 1} depth`,
    `${typeof config.maxConcurrency === "number" ? config.maxConcurrency : 2} concurrency`,
    config.followLinks ? "links" : null,
    config.useSitemaps ? "sitemaps" : null,
    config.itemSelector ? "item selector" : null,
    config.contentSelector ? "content selector" : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export default async function CollectPage() {
  let sources: SourceView[] = [];
  let runs: RunView[] = [];
  let error: string | null = null;
  try {
    [sources, runs] = await Promise.all([listSources(), recentRuns()]);
  } catch (e) {
    error = describeError(e, "collect");
  }

  const enabledCount = sources.filter((s) => s.enabled).length;

  return (
    <main>
      <header className="page-head">
        <div className="eyebrow">Collection agent</div>
        <h1>Collect</h1>
        <p>
          Registered internet sources. A scheduled job (and the buttons below) fetch listings and feed
          them through the same extract → resolve → review pipeline as broker messages. Re-runs are
          idempotent — already-seen items are deduplicated. Use <strong>stub</strong> sources for
          pipeline tests and <strong>HTTP</strong> sources for guarded public-page collection.
        </p>
      </header>

      {error ? (
        <DatabaseError detail={error} />
      ) : (
        <>
          <section className="section" style={{ marginTop: 0 }}>
            <div className="card-row" style={{ marginBottom: 12 }}>
              <span className="muted mono">
                {sources.length} source{sources.length === 1 ? "" : "s"} · {enabledCount} enabled
              </span>
              {enabledCount > 0 && <RunButton label="Run all enabled" />}
            </div>

            {sources.length === 0 ? (
              <div className="empty">No sources yet — add one below to start collecting.</div>
            ) : (
              <div className="stack">
                {sources.map((s) => (
                  <div key={s.id} className="card">
                    <div className="card-row">
                      <span className="card-title">{s.label}</span>
                      <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <span className="chip">{s.kind}</span>
                        <StatusBadge status={s.lastStatus} />
                      </div>
                    </div>
                    <div className="card-sub mono" style={{ wordBreak: "break-all" }}>{s.url}</div>
                    <div className="card-sub">{sourceConfigSummary(s)}</div>
                    <div className="card-sub">
                      last run {when(s.lastRunAt)}
                      {s.lastItemCount != null && ` · ${s.lastItemCount} items`}
                      {s.lastError && <span className="form-msg err"> · {s.lastError}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                      <RunButton sourceId={s.id} label="Run now" />
                      <PreviewButton sourceId={s.id} />
                      <EnableToggle id={s.id} enabled={s.enabled} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="section">
            <h2>Add a source</h2>
            <AddSourceForm />
          </section>

          <section className="section">
            <h2>Recent runs</h2>
            {runs.length === 0 ? (
              <div className="empty">No runs yet.</div>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Status</th>
                    <th>Pages</th>
                    <th>Skip</th>
                    <th>Fail</th>
                    <th>Items</th>
                    <th>New</th>
                    <th>Dup</th>
                    <th>Obs</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{when(r.startedAt)}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td>{r.pagesFetched}</td>
                      <td>{r.pagesSkippedUnchanged}</td>
                      <td>{r.pagesFailed}</td>
                      <td>{r.itemsFetched}</td>
                      <td>{r.signalsNew}</td>
                      <td>{r.signalsDuplicate}</td>
                      <td>{r.observationsCreated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </main>
  );
}

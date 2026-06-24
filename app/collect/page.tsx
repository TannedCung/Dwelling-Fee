import { Icon } from "../_components/icon";
import { DatabaseError } from "../_components/notice";
import { AddSourceForm, EnableToggle } from "./collect-actions";
import { EnqueueEdgeJobButton, RegisterDeviceForm, RevokeDeviceButton } from "./edge-device-actions";
import { listSources, type SourceView } from "../../lib/collection";
import { listEdgeDashboard } from "../../lib/edge/service";
import { describeError } from "../../lib/page-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EdgeDashboard = Awaited<ReturnType<typeof listEdgeDashboard>>;

type UserActionDetails = {
  url: string;
  reason: string;
  remoteBrowserUrl: string | null;
  solveDeadlineAt: string | null;
};

const when = (d: Date | null) => (d ? new Date(d).toLocaleString() : "-");

function userActionDetails(value: unknown): UserActionDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || typeof record.reason !== "string") return null;
  return {
    url: record.url,
    reason: record.reason,
    remoteBrowserUrl: typeof record.remoteBrowserUrl === "string" ? record.remoteBrowserUrl : null,
    solveDeadlineAt: typeof record.solveDeadlineAt === "string" ? record.solveDeadlineAt : null,
  };
}

function StatusBadge({ status }: { status: "ok" | "error" | null }) {
  if (!status) return <span className="badge neutral">never run</span>;
  return (
    <span className={`badge ${status === "ok" ? "committed" : "failed"}`}>
      <Icon name={status === "ok" ? "check-circle" : "triangle-alert"} size={13} />
      {status}
    </span>
  );
}

function DeviceStatus({ status, lastSeenAt }: { status: string; lastSeenAt: Date | null }) {
  const online = status === "active" && lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 2 * 60_000;
  if (status === "revoked") return <span className="badge failed">revoked</span>;
  return <span className={`badge ${online ? "committed" : "neutral"}`}>{online ? "online" : "offline"}</span>;
}

function JobStatus({ status }: { status: string }) {
  const cls = status === "succeeded" ? "committed" : status === "failed" || status === "needs_user_action" ? "failed" : "neutral";
  return <span className={`badge ${cls}`}>{status.replaceAll("_", " ")}</span>;
}

function sourceConfigSummary(source: SourceView) {
  const config = source.config && typeof source.config === "object" && !Array.isArray(source.config) ? source.config as Record<string, unknown> : {};
  const parts = [
    `${typeof config.maxPages === "number" ? config.maxPages : 10} max pages`,
    `${typeof config.maxDepth === "number" ? config.maxDepth : 1} depth`,
    config.followLinks ? "follow links" : null,
    config.itemSelector ? "item selector" : null,
    config.contentSelector ? "content selector" : null,
    config.linkSelector ? "link selector" : null,
    typeof config.minItems === "number" ? `${config.minItems} min items` : null,
    typeof config.solveTimeoutMs === "number" ? `${Math.round(config.solveTimeoutMs / 1000)}s solve window` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export default async function CollectPage() {
  let sources: SourceView[] = [];
  let edge: EdgeDashboard | null = null;
  let error: string | null = null;
  try {
    [sources, edge] = await Promise.all([listSources(), listEdgeDashboard()]);
  } catch (e) {
    error = describeError(e, "collect");
  }

  const enabledCount = sources.filter((s) => s.enabled).length;
  const sourceLabel = new Map(sources.map((s) => [s.id, s.label]));
  const userActions = new Map<string, UserActionDetails>();
  for (const event of edge?.events ?? []) {
    if (event.type !== "job.user_action_required" || !event.jobId || userActions.has(event.jobId)) continue;
    const details = userActionDetails(event.details);
    if (details) userActions.set(event.jobId, details);
  }
  const waitingJobs = (edge?.jobs ?? []).filter((job) => job.status === "needs_user_action");

  return (
    <main>
      <header className="page-head">
        <div className="eyebrow">Edge collection</div>
        <h1>Collect</h1>
        <p>
          Register public listing sources, queue browser crawl jobs, and manage trusted edge devices.
          The app stores the source registry, queue, deduplication, distillation, and review pipeline;
          local edge devices perform the actual page collection.
        </p>
      </header>

      {error || !edge ? (
        <DatabaseError detail={error ?? "Could not load collection dashboard."} />
      ) : (
        <>
          {waitingJobs.length > 0 && (
            <section className="notice" style={{ marginTop: 0, marginBottom: 16 }}>
              <div className="card-row">
                <span className="card-title">
                  <Icon name="triangle-alert" size={15} /> Browser verification required
                </span>
                <span className="badge failed">{waitingJobs.length} waiting</span>
              </div>
              <div className="stack" style={{ marginTop: 10, gap: 10 }}>
                {waitingJobs.map((job) => {
                  const action = userActions.get(job.id);
                  return (
                    <div key={job.id} className="card-row" style={{ alignItems: "flex-start", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="card-title" style={{ fontSize: 14 }}>
                          {sourceLabel.get(job.sourceId) ?? job.sourceId.slice(0, 8)}
                        </div>
                        <div className="card-sub mono" style={{ wordBreak: "break-all" }}>
                          {action?.url ?? job.error ?? "Worker is waiting for browser action."}
                        </div>
                        <div className="card-sub">
                          {action?.reason ?? job.error ?? "Access challenge"} · deadline{" "}
                          {action?.solveDeadlineAt ? new Date(action.solveDeadlineAt).toLocaleString() : "-"}
                        </div>
                      </div>
                      {action?.remoteBrowserUrl ? (
                        <a className="btn primary sm" href={action.remoteBrowserUrl} target="_blank" rel="noreferrer">
                          <Icon name="monitor" size={15} /> Open remote browser
                        </a>
                      ) : (
                        <span className="badge neutral">no remote URL</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="section" style={{ marginTop: 0 }}>
            <div className="card-row" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Sources</h2>
              <span className="muted mono">
                {sources.length} source{sources.length === 1 ? "" : "s"} · {enabledCount} enabled
              </span>
            </div>

            {sources.length === 0 ? (
              <div className="empty">No sources yet. Add one below, then queue an edge crawl.</div>
            ) : (
              <div className="stack">
                {sources.map((s) => (
                  <div key={s.id} className="card">
                    <div className="card-row">
                      <span className="card-title">{s.label}</span>
                      <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <span className="chip">edge</span>
                        <StatusBadge status={s.lastStatus} />
                      </div>
                    </div>
                    <div className="card-sub mono" style={{ wordBreak: "break-all" }}>{s.url}</div>
                    <div className="card-sub">{sourceConfigSummary(s)}</div>
                    <div className="card-sub">
                      last crawl {when(s.lastRunAt)}
                      {s.lastItemCount != null && ` · ${s.lastItemCount} items`}
                      {s.lastError && <span className="form-msg err"> · {s.lastError}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                      <EnqueueEdgeJobButton sourceId={s.id} />
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
            <div className="card-row" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Devices</h2>
              <span className="muted mono">{edge.devices.length} registered</span>
            </div>
            <RegisterDeviceForm />
            <div className="stack" style={{ marginTop: 14 }}>
              {edge.devices.length === 0 ? (
                <div className="empty">No edge devices registered.</div>
              ) : (
                edge.devices.map((device) => (
                  <div key={device.id} className="card">
                    <div className="card-row">
                      <span className="card-title">{device.name}</span>
                      <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <DeviceStatus status={device.status} lastSeenAt={device.lastSeenAt} />
                        <RevokeDeviceButton id={device.id} disabled={device.status === "revoked"} />
                      </div>
                    </div>
                    <div className="card-sub mono">{device.id}</div>
                    <div className="card-sub">
                      last seen {when(device.lastSeenAt)} · version {device.version ?? "-"} · current job {device.currentJobId?.slice(0, 8) ?? "-"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="section">
            <div className="card-row" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Queue</h2>
              <span className="muted mono">{edge.jobs.length} recent jobs</span>
            </div>
            {edge.jobs.length === 0 ? (
              <div className="empty">No edge crawl jobs yet.</div>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Device</th>
                    <th>Pages</th>
                    <th>Items</th>
                    <th>New</th>
                    <th>Dup</th>
                    <th>Obs</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {edge.jobs.map((job) => {
                    const action = userActions.get(job.id);
                    return (
                      <tr key={job.id}>
                        <td className="mono">{when(job.createdAt)}</td>
                        <td>{sourceLabel.get(job.sourceId) ?? job.sourceId.slice(0, 8)}</td>
                        <td><JobStatus status={job.status} /></td>
                        <td className="mono">{job.leaseDeviceId?.slice(0, 8) ?? "-"}</td>
                        <td>{job.pagesSubmitted}</td>
                        <td>{job.itemsSubmitted}</td>
                        <td>{job.signalsNew}</td>
                        <td>{job.signalsDuplicate}</td>
                        <td>{job.observationsCreated}</td>
                        <td>
                          {job.status === "needs_user_action" && action?.remoteBrowserUrl ? (
                            <a className="btn secondary sm" href={action.remoteBrowserUrl} target="_blank" rel="noreferrer">
                              <Icon name="monitor" size={14} /> Open
                            </a>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="section">
            <h2>Events</h2>
            {edge.events.length === 0 ? (
              <div className="empty">No edge events yet.</div>
            ) : (
              <div className="stack">
                {edge.events.map((event) => (
                  <div key={event.id} className="notice" style={{ padding: 10 }}>
                    <div className="card-row">
                      <span className="card-title" style={{ fontSize: 14 }}>
                        <Icon name={event.level === "error" ? "triangle-alert" : "info"} size={14} /> {event.type}
                      </span>
                      <span className="muted mono">{when(event.createdAt)}</span>
                    </div>
                    <div className="card-sub">{event.message}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

import { Icon } from "../_components/icon";
import { DatabaseError } from "../_components/notice";
import { describeError } from "../../lib/page-error";
import { listEdgeDashboard } from "../../lib/edge/service";
import { EnqueueEdgeJobButton, RegisterDeviceForm, RevokeDeviceButton } from "./edge-device-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const when = (d: Date | null) => (d ? new Date(d).toLocaleString() : "—");

function DeviceStatus({ status, lastSeenAt }: { status: string; lastSeenAt: Date | null }) {
  const online = status === "active" && lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 2 * 60_000;
  if (status === "revoked") return <span className="badge failed">revoked</span>;
  return <span className={`badge ${online ? "committed" : "neutral"}`}>{online ? "online" : "offline"}</span>;
}

function JobStatus({ status }: { status: string }) {
  const cls = status === "succeeded" ? "committed" : status === "failed" || status === "needs_user_action" ? "failed" : "neutral";
  return <span className={`badge ${cls}`}>{status.replaceAll("_", " ")}</span>;
}

export default async function EdgeDevicesPage() {
  let data: Awaited<ReturnType<typeof listEdgeDashboard>> | null = null;
  let error: string | null = null;
  try {
    data = await listEdgeDashboard();
  } catch (e) {
    error = describeError(e, "edge.devices");
  }

  const sourceLabel = new Map((data?.sources ?? []).map((s) => [s.id, s.label]));

  return (
    <main>
      <header className="page-head">
        <div className="eyebrow">Local crawler workers</div>
        <h1>Edge Devices</h1>
        <p>
          Register trusted local devices, queue Playwright crawl jobs, and watch worker health,
          streamed results, and audit events. Vercel owns the queue and ingestion; devices only run
          assigned crawl jobs.
        </p>
      </header>

      {error || !data ? (
        <DatabaseError detail={error ?? "Could not load edge devices."} />
      ) : (
        <>
          <section className="section" style={{ marginTop: 0 }}>
            <div className="card-row" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Devices</h2>
              <span className="muted mono">{data.devices.length} registered</span>
            </div>
            <RegisterDeviceForm />
            <div className="stack" style={{ marginTop: 14 }}>
              {data.devices.length === 0 ? (
                <div className="empty">No edge devices registered.</div>
              ) : (
                data.devices.map((device) => (
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
                      last seen {when(device.lastSeenAt)} · version {device.version ?? "—"} · current job {device.currentJobId?.slice(0, 8) ?? "—"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="section">
            <div className="card-row" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Queue</h2>
              <span className="muted mono">{data.jobs.length} recent jobs</span>
            </div>
            <div className="card-grid">
              {data.sources.map((source) => (
                <div key={source.id} className="card">
                  <div className="card-row">
                    <span className="card-title">{source.label}</span>
                    <span className={`badge ${source.enabled ? "committed" : "neutral"}`}>{source.enabled ? "enabled" : "disabled"}</span>
                  </div>
                  <div className="card-sub mono" style={{ wordBreak: "break-all" }}>{source.url}</div>
                  <div style={{ marginTop: 8 }}>
                    <EnqueueEdgeJobButton sourceId={source.id} />
                  </div>
                </div>
              ))}
            </div>
            {data.jobs.length === 0 ? (
              <div className="empty" style={{ marginTop: 14 }}>No edge crawl jobs yet.</div>
            ) : (
              <table className="data" style={{ marginTop: 14 }}>
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
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((job) => (
                    <tr key={job.id}>
                      <td className="mono">{when(job.createdAt)}</td>
                      <td>{sourceLabel.get(job.sourceId) ?? job.sourceId.slice(0, 8)}</td>
                      <td><JobStatus status={job.status} /></td>
                      <td className="mono">{job.leaseDeviceId?.slice(0, 8) ?? "—"}</td>
                      <td>{job.pagesSubmitted}</td>
                      <td>{job.itemsSubmitted}</td>
                      <td>{job.signalsNew}</td>
                      <td>{job.signalsDuplicate}</td>
                      <td>{job.observationsCreated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="section">
            <h2>Events</h2>
            {data.events.length === 0 ? (
              <div className="empty">No edge events yet.</div>
            ) : (
              <div className="stack">
                {data.events.map((event) => (
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

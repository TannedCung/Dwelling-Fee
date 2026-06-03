import Link from "next/link";
import type { SessionListItem } from "../../lib/ingest";
import { NewSessionButton } from "../_components/new-session-button";

const STATUS_LABEL: Record<string, string> = {
  open: "open",
  committed: "committed",
  abandoned: "abandoned",
};

function relativeDate(value: Date): string {
  const days = Math.round((Date.now() - value.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function SessionsRail({
  sessions,
  activeId,
}: {
  sessions: SessionListItem[];
  activeId?: string;
}) {
  return (
    <aside className="sessions-rail">
      <div className="sr-head">
        <span className="sr-title">Sessions</span>
        <NewSessionButton className="btn primary sm" label="New" pendingLabel="New" />
      </div>
      <div className="sr-list">
        {sessions.length === 0 ? (
          <div className="sr-empty">No sessions yet.</div>
        ) : (
          sessions.map((s) => (
            <Link key={s.id} href={`/ingest/${s.id}`} className={`sr-item ${s.id === activeId ? "on" : ""}`}>
              <div className="sr-item-top">
                <span className="sr-item-title">{s.title ?? "Untitled session"}</span>
                <span className={`sr-dot ${s.status}`} title={STATUS_LABEL[s.status] ?? s.status} />
              </div>
              <div className="sr-item-meta">
                <span>
                  {s.status === "committed"
                    ? `${s.committedObs} obs`
                    : s.status === "abandoned"
                      ? "abandoned"
                      : `${s.draftCount} draft`}
                </span>
                <span>·</span>
                <span>{relativeDate(s.createdAt)}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </aside>
  );
}

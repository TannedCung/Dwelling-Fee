import Link from "next/link";
import { listSessions, type SessionListItem } from "../lib/ingest";
import { NewSessionButton } from "./_components/new-session-button";
import { DatabaseError } from "./_components/notice";
import { describeError } from "../lib/page-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_CLASS: Record<string, string> = {
  open: "open",
  committed: "committed",
  abandoned: "abandoned",
};

export default async function Home() {
  let sessions: SessionListItem[] = [];
  let error: string | null = null;
  try {
    sessions = await listSessions();
  } catch (e) {
    error = describeError(e, "home");
  }

  return (
    <main>
      <header className="page-head">
        <div className="eyebrow">Ingest</div>
        <h1>Ingest &amp; extract</h1>
        <p>
          Paste a broker message — it&apos;s stored verbatim, then extracted into structured price
          observations. Refine with the assistant, then commit; committed observations trace back to
          their session.
        </p>
      </header>

      <NewSessionButton />

      <section className="section">
        <h2>Sessions</h2>
        {error ? (
          <DatabaseError detail={error} />
        ) : sessions.length === 0 ? (
          <div className="empty">No sessions yet — start one above.</div>
        ) : (
          <div className="card-grid">
            {sessions.map((s) => (
              <Link key={s.id} href={`/ingest/${s.id}`} className="card interactive">
                <div className="card-row">
                  <span className="card-title">{s.title ?? "Untitled session"}</span>
                  <span className={`badge ${STATUS_CLASS[s.status] ?? "neutral"}`}>{s.status}</span>
                </div>
                <div className="card-sub">
                  <span className="mono">
                    {s.status === "committed"
                      ? `${s.committedObs} observation(s) committed`
                      : `${s.draftCount} propert${s.draftCount === 1 ? "y" : "ies"} in draft`}
                  </span>
                  {" · "}
                  {new Date(s.createdAt).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

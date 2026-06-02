import Link from "next/link";
import { listSessions, type SessionListItem } from "../lib/ingest";
import { NewSessionButton } from "./_components/new-session-button";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_COLOR: Record<string, string> = { open: "#1a73e8", committed: "#137333", abandoned: "#999" };

export default async function Home() {
  let sessions: SessionListItem[] = [];
  let error: string | null = null;
  try {
    sessions = await listSessions();
  } catch (e) {
    error = e instanceof Error ? e.message : "database unavailable";
  }

  return (
    <main style={{ display: "grid", gap: 20 }}>
      <header>
        <h1 style={{ marginBottom: 4 }}>Ingest</h1>
        <p style={{ color: "#666", margin: 0 }}>
          Start a conversation to turn broker messages into structured property records. Paste, refine
          with the assistant, then commit — committed observations trace back to their session.
        </p>
      </header>

      <NewSessionButton />

      <section>
        <h2 style={{ fontSize: 18 }}>Sessions</h2>
        {error ? (
          <p style={{ color: "#b00" }}>Database not reachable ({error}).</p>
        ) : sessions.length === 0 ? (
          <p style={{ color: "#888" }}>No sessions yet — start one above.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
            {sessions.map((s) => (
              <li key={s.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <Link href={`/ingest/${s.id}`} style={{ fontWeight: 600 }}>
                    {s.title ?? "Untitled session"}
                  </Link>
                  <span style={{ fontSize: 12, color: STATUS_COLOR[s.status] ?? "#888" }}>{s.status}</span>
                </div>
                <div style={{ fontSize: 13, color: "#888" }}>
                  {s.status === "committed"
                    ? `${s.committedObs} observation(s) committed`
                    : `${s.draftCount} propert${s.draftCount === 1 ? "y" : "ies"} in draft`}
                  {" · "}
                  {new Date(s.createdAt).toLocaleDateString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

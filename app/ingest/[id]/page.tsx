import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "../../../lib/ingest";
import { IngestChat } from "./ingest-chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function IngestSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let session;
  try {
    session = await getSession(id);
  } catch (e) {
    return <p style={{ color: "#b00" }}>Database not reachable ({e instanceof Error ? e.message : "error"}).</p>;
  }
  if (!session) notFound();

  return (
    <main style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0 }}>
        <Link href="/">← Sessions</Link>
      </p>
      <header>
        <h1 style={{ marginBottom: 4, fontSize: 22 }}>{session.title ?? "New ingest session"}</h1>
        <p style={{ color: "#666", margin: 0 }}>
          {session.sourceType} · {session.status}
          {session.status !== "open" && " — this session is closed (read-only)."}
        </p>
      </header>

      <IngestChat
        sessionId={session.id}
        status={session.status}
        initialMessages={session.messages.map((m) => ({ role: m.role, content: m.content }))}
        initialDraft={session.draft}
      />
    </main>
  );
}

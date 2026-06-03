import { notFound } from "next/navigation";
import { getSession, listSessions, type SessionListItem } from "../../../lib/ingest";
import { IngestChat } from "./ingest-chat";
import { DatabaseError } from "../../_components/notice";
import { describeError } from "../../../lib/page-error";
import { SessionsRail } from "../sessions-rail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function IngestSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let session;
  let sessions: SessionListItem[] = [];
  try {
    session = await getSession(id);
    sessions = await listSessions();
  } catch (e) {
    return <DatabaseError detail={describeError(e, "ingest.session")} />;
  }
  if (!session) notFound();

  return (
    <main className="ingest-workspace rail-open">
      <SessionsRail sessions={sessions} activeId={session.id} />
      <IngestChat
        sessionId={session.id}
        status={session.status}
        sourceType={session.sourceType}
        title={session.title}
        initialMessages={session.messages.map((m) => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments,
          createdAt: m.createdAt.toISOString(),
        }))}
        initialDraft={session.draft}
      />
    </main>
  );
}

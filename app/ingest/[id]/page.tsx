import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "../../../lib/ingest";
import { IngestChat } from "./ingest-chat";
import { Icon } from "../../_components/icon";
import { DatabaseError } from "../../_components/notice";
import { describeError } from "../../../lib/page-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function IngestSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let session;
  try {
    session = await getSession(id);
  } catch (e) {
    return <DatabaseError detail={describeError(e, "ingest.session")} />;
  }
  if (!session) notFound();

  return (
    <main>
      <Link href="/" className="back-link" style={{ marginBottom: 16 }}>
        <Icon name="arrow-left" size={15} /> Sessions
      </Link>
      <header className="page-head">
        <div className="eyebrow">Ingest session</div>
        <h1>{session.title ?? "New ingest session"}</h1>
        <p>
          {session.sourceType} · {session.status}
          {session.status !== "open" && " — this session is closed (read-only)."}
        </p>
      </header>

      <IngestChat
        sessionId={session.id}
        status={session.status}
        initialMessages={session.messages.map((m) => ({ role: m.role, content: m.content, attachments: m.attachments }))}
        initialDraft={session.draft}
      />
    </main>
  );
}

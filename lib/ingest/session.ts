import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbExecutor } from "../../db/client";
import { ingestSession, ingestMessage, priceObservation } from "../../db/schema";
import { PropertyExtraction } from "../extraction/schema";

export type SourceType = "broker" | "web" | "agent" | "user";
export type SessionStatus = "open" | "committed" | "abandoned";

const DraftSchema = z.array(PropertyExtraction);

/** Parse the stored draft jsonb back into typed properties, tolerating null/garbage. */
export function parseDraft(value: unknown): PropertyExtraction[] {
  const parsed = DraftSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

export interface SessionView {
  id: string;
  status: SessionStatus;
  sourceType: SourceType;
  title: string | null;
  draft: PropertyExtraction[];
  committedAt: Date | null;
  messages: SessionMessage[];
}

const GREETING =
  "Paste a broker message or listing and I'll pull out the structured details. We can refine it together, then commit when it looks right.";

export async function createSession(sourceType: SourceType = "broker"): Promise<string> {
  const db = getDb();
  const [row] = await db.insert(ingestSession).values({ sourceType }).returning({ id: ingestSession.id });
  const id = row!.id;
  await db.insert(ingestMessage).values({ sessionId: id, role: "assistant", content: GREETING });
  return id;
}

export async function getSession(id: string): Promise<SessionView | null> {
  const db = getDb();
  const s = await db.query.ingestSession.findFirst({ where: eq(ingestSession.id, id) });
  if (!s) return null;
  const messages = await db
    .select({ id: ingestMessage.id, role: ingestMessage.role, content: ingestMessage.content, createdAt: ingestMessage.createdAt })
    .from(ingestMessage)
    .where(eq(ingestMessage.sessionId, id))
    .orderBy(asc(ingestMessage.createdAt));
  return {
    id: s.id,
    status: s.status,
    sourceType: s.sourceType,
    title: s.title,
    draft: parseDraft(s.draft),
    committedAt: s.committedAt,
    messages,
  };
}

export async function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  db: DbExecutor = getDb(),
): Promise<void> {
  await db.insert(ingestMessage).values({ sessionId, role, content });
  await db.update(ingestSession).set({ updatedAt: new Date() }).where(eq(ingestSession.id, sessionId));
}

export async function updateDraft(sessionId: string, draft: PropertyExtraction[], title?: string | null): Promise<void> {
  const db = getDb();
  const patch: { draft: PropertyExtraction[]; updatedAt: Date; title?: string } = { draft, updatedAt: new Date() };
  if (title) patch.title = title;
  await db.update(ingestSession).set(patch).where(eq(ingestSession.id, sessionId));
}

export interface SessionListItem {
  id: string;
  status: SessionStatus;
  title: string | null;
  draftCount: number;
  committedObs: number;
  createdAt: Date;
  committedAt: Date | null;
}

export async function listSessions(limit = 30): Promise<SessionListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: ingestSession.id,
      status: ingestSession.status,
      title: ingestSession.title,
      draft: ingestSession.draft,
      createdAt: ingestSession.createdAt,
      committedAt: ingestSession.committedAt,
      committedObs: sql<number>`count(${priceObservation.id})`.mapWith(Number),
    })
    .from(ingestSession)
    .leftJoin(priceObservation, eq(priceObservation.ingestSessionId, ingestSession.id))
    .groupBy(ingestSession.id)
    .orderBy(desc(ingestSession.updatedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    title: r.title,
    draftCount: parseDraft(r.draft).length,
    committedObs: r.committedObs,
    createdAt: r.createdAt,
    committedAt: r.committedAt,
  }));
}

/** Concatenated user-supplied text — the human source material for provenance. */
export async function userSourceText(sessionId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ content: ingestMessage.content })
    .from(ingestMessage)
    .where(and(eq(ingestMessage.sessionId, sessionId), eq(ingestMessage.role, "user")))
    .orderBy(asc(ingestMessage.createdAt));
  return rows.map((r) => r.content).join("\n\n---\n\n");
}

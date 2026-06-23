import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DbExecutor } from "../../db/client";
import { ingestSession, ingestMessage, priceObservation } from "../../db/schema";
import { PropertyExtraction } from "../extraction/schema";
import { ProjectCurationDraftSchema, type ProjectCurationDraft } from "./project-curation";
import { parseAttachments, persistableAttachments, type Attachment } from "../storage/r2";

export type SourceType = "broker" | "web" | "agent" | "user";
export type SessionStatus = "open" | "committed" | "abandoned";

const DraftSchema = z.array(PropertyExtraction);
const DraftStateSchema = z.object({
  properties: z.array(PropertyExtraction),
  projectCuration: z.array(ProjectCurationDraftSchema).optional(),
});

export interface DraftState {
  properties: PropertyExtraction[];
  projectCuration: ProjectCurationDraft[];
}

/** Parse the stored draft jsonb back into typed properties, tolerating null/garbage. */
export function parseDraft(value: unknown): PropertyExtraction[] {
  return parseDraftState(value).properties;
}

export function parseDraftState(value: unknown): DraftState {
  const current = DraftStateSchema.safeParse(value);
  if (current.success) {
    return {
      properties: current.data.properties,
      projectCuration: current.data.projectCuration ?? [],
    };
  }
  const legacy = DraftSchema.safeParse(value);
  return {
    properties: legacy.success ? legacy.data : [],
    projectCuration: [],
  };
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments: Attachment[];
  createdAt: Date;
}

export interface SessionView {
  id: string;
  status: SessionStatus;
  sourceType: SourceType;
  title: string | null;
  draft: PropertyExtraction[];
  projectCuration: ProjectCurationDraft[];
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
  const draftState = parseDraftState(s.draft);
  const messages = await db
    .select({
      id: ingestMessage.id,
      role: ingestMessage.role,
      content: ingestMessage.content,
      attachments: ingestMessage.attachments,
      createdAt: ingestMessage.createdAt,
    })
    .from(ingestMessage)
    .where(eq(ingestMessage.sessionId, id))
    .orderBy(asc(ingestMessage.createdAt));
  return {
    id: s.id,
    status: s.status,
    sourceType: s.sourceType,
    title: s.title,
    draft: draftState.properties,
    projectCuration: draftState.projectCuration,
    committedAt: s.committedAt,
    messages: messages.map((m) => ({ ...m, attachments: parseAttachments(m.attachments) })),
  };
}

export async function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  dbOrAttachments: DbExecutor | Attachment[] = getDb(),
  attachments: Attachment[] = [],
): Promise<void> {
  const db = Array.isArray(dbOrAttachments) ? getDb() : dbOrAttachments;
  const files = Array.isArray(dbOrAttachments) ? dbOrAttachments : attachments;
  await db.insert(ingestMessage).values({
    sessionId,
    role,
    content,
    attachments: files.length > 0 ? persistableAttachments(files) : null,
  });
  await db.update(ingestSession).set({ updatedAt: new Date() }).where(eq(ingestSession.id, sessionId));
}

export async function updateDraft(
  sessionId: string,
  draft: PropertyExtraction[],
  title?: string | null,
  projectCuration: ProjectCurationDraft[] = [],
): Promise<void> {
  const db = getDb();
  const patch: { draft: DraftState; updatedAt: Date; title?: string } = {
    draft: { properties: draft, projectCuration },
    updatedAt: new Date(),
  };
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

export async function userAttachments(sessionId: string): Promise<Attachment[]> {
  const db = getDb();
  const rows = await db
    .select({ attachments: ingestMessage.attachments })
    .from(ingestMessage)
    .where(and(eq(ingestMessage.sessionId, sessionId), eq(ingestMessage.role, "user")))
    .orderBy(asc(ingestMessage.createdAt));
  return rows.flatMap((r) => parseAttachments(r.attachments));
}

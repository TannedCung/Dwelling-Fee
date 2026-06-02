import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { collectionSource, collectionRun } from "../../db/schema";

export type CollectionKind = "stub" | "http";

export interface SourceView {
  id: string;
  label: string;
  url: string;
  kind: CollectionKind;
  enabled: boolean;
  lastRunAt: Date | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  lastItemCount: number | null;
  createdAt: Date;
}

export async function listSources(): Promise<SourceView[]> {
  const db = getDb();
  return db.select().from(collectionSource).orderBy(desc(collectionSource.createdAt)) as Promise<SourceView[]>;
}

export async function getSource(id: string) {
  const db = getDb();
  return db.query.collectionSource.findFirst({ where: eq(collectionSource.id, id) });
}

export async function createSource(input: {
  label: string;
  url: string;
  kind?: CollectionKind;
}): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(collectionSource)
    .values({ label: input.label, url: input.url, kind: input.kind ?? "stub" })
    .returning({ id: collectionSource.id });
  return row!.id;
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const db = getDb();
  await db.update(collectionSource).set({ enabled }).where(eq(collectionSource.id, id));
}

export interface RunView {
  id: string;
  sourceId: string;
  status: "ok" | "error";
  itemsFetched: number;
  signalsNew: number;
  signalsDuplicate: number;
  observationsCreated: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export async function recentRuns(limit = 20): Promise<RunView[]> {
  const db = getDb();
  return db
    .select()
    .from(collectionRun)
    .orderBy(desc(collectionRun.startedAt))
    .limit(limit) as Promise<RunView[]>;
}

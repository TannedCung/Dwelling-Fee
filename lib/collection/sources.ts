import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { collectionSource } from "../../db/schema";
import { ensureCollectionSchema } from "../db/ensure-schema";

export type CollectionKind = "stub" | "http";

export interface SourceView {
  id: string;
  label: string;
  url: string;
  kind: CollectionKind;
  enabled: boolean;
  config: unknown;
  lastRunAt: Date | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  lastItemCount: number | null;
  createdAt: Date;
}

export async function listSources(): Promise<SourceView[]> {
  await ensureCollectionSchema();
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
  kind?: "http";
  config?: unknown;
}): Promise<string> {
  await ensureCollectionSchema();
  const db = getDb();
  const [row] = await db
    .insert(collectionSource)
    .values({ label: input.label, url: input.url, kind: input.kind ?? "http", config: input.config ?? null })
    .returning({ id: collectionSource.id });
  return row!.id;
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  await ensureCollectionSchema();
  const db = getDb();
  await db.update(collectionSource).set({ enabled }).where(eq(collectionSource.id, id));
}

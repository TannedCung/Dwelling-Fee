import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb, transaction, type DbExecutor } from "../../db/client";
import { collectionSource, crawlJob, edgeDeviceEvent } from "../../db/schema";
import { ensureEdgeSchema } from "../db/ensure-schema";

export const ACTIVE_CRAWL_JOB_STATUSES = ["queued", "leased", "running", "needs_user_action"] as const;

const DEFAULT_LIMIT = 25;
const SOURCE_SCAN_LIMIT = 100;

export const ScheduledEdgeCrawlInput = z.object({
  limit: z.number().int().min(1).max(100).default(DEFAULT_LIMIT),
  priority: z.number().int().min(0).max(100).default(0),
});

type SourceForSchedule = {
  id: string;
  label: string;
  url: string;
  kind: "stub" | "http";
  enabled: boolean;
  config: unknown;
};

type ActiveJobForSchedule = {
  sourceId: string;
};

export function selectSchedulableSources(
  sources: SourceForSchedule[],
  activeJobs: ActiveJobForSchedule[],
): SourceForSchedule[] {
  const activeSourceIds = new Set(activeJobs.map((job) => job.sourceId));
  return sources.filter((source) => source.enabled && !activeSourceIds.has(source.id));
}

export async function enqueueScheduledEdgeCrawlJobs(
  input: z.infer<typeof ScheduledEdgeCrawlInput> = ScheduledEdgeCrawlInput.parse({}),
): Promise<{
  considered: number;
  queued: number;
  skippedActive: number;
  skippedLimit: number;
  jobIds: string[];
}> {
  const options = ScheduledEdgeCrawlInput.parse(input);
  await ensureEdgeSchema();
  const now = new Date();

  return transaction(async (tx) => {
    await expireStaleEdgeLeases(now, tx);

    const sources = await tx
      .select({
        id: collectionSource.id,
        label: collectionSource.label,
        url: collectionSource.url,
        kind: collectionSource.kind,
        enabled: collectionSource.enabled,
        config: collectionSource.config,
      })
      .from(collectionSource)
      .where(eq(collectionSource.enabled, true))
      .orderBy(asc(collectionSource.createdAt))
      .limit(SOURCE_SCAN_LIMIT);

    const activeJobs = await tx
      .select({ sourceId: crawlJob.sourceId })
      .from(crawlJob)
      .where(inArray(crawlJob.status, ACTIVE_CRAWL_JOB_STATUSES));

    const schedulable = selectSchedulableSources(sources, activeJobs);
    const selected = schedulable.slice(0, options.limit);
    const jobIds: string[] = [];

    for (const source of selected) {
      const [row] = await tx
        .insert(crawlJob)
        .values({
          sourceId: source.id,
          payload: buildEdgeCrawlPayload(source),
          priority: options.priority,
        })
        .returning({ id: crawlJob.id });

      if (!row) continue;
      jobIds.push(row.id);
      await tx.insert(edgeDeviceEvent).values({
        jobId: row.id,
        type: "job.enqueued",
        message: `Scheduled edge crawl for ${source.label}.`,
        details: { sourceId: source.id, url: source.url, trigger: "cron" },
      });
    }

    return {
      considered: sources.length,
      queued: jobIds.length,
      skippedActive: sources.length - schedulable.length,
      skippedLimit: schedulable.length - selected.length,
      jobIds,
    };
  });
}

export async function expireStaleEdgeLeases(now = new Date(), db: DbExecutor = getDb()): Promise<void> {
  await db
    .update(crawlJob)
    .set({
      status: "expired",
      leaseDeviceId: null,
      leaseExpiresAt: null,
      updatedAt: now,
      error: "Lease expired before completion.",
    })
    .where(and(inArray(crawlJob.status, ["leased", "running", "needs_user_action"]), lt(crawlJob.leaseExpiresAt, now)));
}

function buildEdgeCrawlPayload(source: SourceForSchedule) {
  return {
    mode: "playwright_edge",
    source: {
      id: source.id,
      label: source.label,
      url: source.url,
      kind: source.kind,
      config: source.config,
    },
  };
}

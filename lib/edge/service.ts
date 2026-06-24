import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, transaction, type DbExecutor } from "../../db/client";
import {
  collectionSource,
  crawlJob,
  crawlResultItem,
  crawlResultPage,
  edgeDevice,
  edgeDeviceEvent,
  edgeDeviceNonce,
} from "../../db/schema";
import { badRequest, unauthorized } from "../api/respond";
import { ensureEdgeSchema } from "../db/ensure-schema";
import { ingestSignal } from "../ingest";
import { distillEdgePost } from "./distill";
import {
  EDGE_AUTH_HEADERS,
  deviceSecretHash,
  generateDeviceSecret,
  randomNonce,
  sha256Hex,
  signWithDeviceKey,
  verifyEdgeSignature,
} from "./protocol";

const MAX_BODY_BYTES = 1_500_000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_LEASE_SECONDS = 120;
const HEARTBEAT_LEASE_EXTENSION_SECONDS = 300;

const DeviceScopes = z.object({
  sourceIds: z.array(z.string().uuid()).optional(),
  allowedDomains: z.array(z.string().min(1)).optional(),
}).partial();

export const RegisterDeviceInput = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: DeviceScopes.nullish(),
});

export const EnqueueJobInput = z.object({
  sourceId: z.string().uuid(),
  priority: z.number().int().min(0).max(100).optional(),
});

export const HeartbeatInput = z.object({
  version: z.string().max(80).optional(),
  currentJobId: z.string().uuid().nullable().optional(),
});

export const LeaseInput = z.object({
  version: z.string().max(80).optional(),
  leaseSeconds: z.number().int().min(30).max(600).optional(),
});

const ResultPageInput = z.object({
  canonicalUrl: z.string().url(),
  status: z.enum(["fetched", "skipped_unchanged", "failed"]),
  httpStatus: z.number().int().min(100).max(599).optional(),
  contentHash: z.string().max(128).nullable().optional(),
  textHash: z.string().max(128).nullable().optional(),
  fetchDurationMs: z.number().int().min(0).max(600_000).optional(),
  bytesFetched: z.number().int().min(0).max(5_000_000).optional(),
  textLength: z.number().int().min(0).max(500_000).optional(),
  itemCount: z.number().int().min(0).max(1000).optional(),
  error: z.string().max(2000).optional(),
  fetchedAt: z.string().datetime().optional(),
});

const ResultItemInput = z.object({
  sourceRef: z.string().trim().min(1).max(2000),
  pageUrl: z.string().url().optional(),
  sourceType: z.enum(["broker", "web", "agent", "user"]).default("web"),
  text: z.string().trim().min(1).max(120_000),
  capturedAt: z.string().datetime().optional(),
});

export const SubmitResultsInput = z.object({
  pages: z.array(ResultPageInput).max(5).default([]),
  items: z.array(ResultItemInput).max(10).default([]),
});

export const CompleteJobInput = z.object({
  status: z.enum(["succeeded", "failed", "needs_user_action"]),
  error: z.string().max(2000).optional(),
  metrics: z.record(z.unknown()).optional(),
});

export const UserActionInput = z.object({
  url: z.string().url(),
  reason: z.string().trim().min(1).max(500),
  remoteBrowserUrl: z.string().url().optional(),
  solveDeadlineAt: z.string().datetime().optional(),
});

export interface AuthenticatedDevice {
  id: string;
  name: string;
  tokenHash: string;
  scopes: unknown;
  version: string | null;
  status: "active" | "revoked";
}

export async function registerEdgeDevice(input: z.infer<typeof RegisterDeviceInput>) {
  await ensureEdgeSchema();
  const secret = generateDeviceSecret();
  const secretHash = deviceSecretHash(secret);
  const [row] = await getDb()
    .insert(edgeDevice)
    .values({
      name: input.name,
      tokenHash: secretHash,
      scopes: input.scopes ?? null,
      lastSeenAt: null,
    })
    .returning({ id: edgeDevice.id, name: edgeDevice.name });
  await logEdgeEvent({
    deviceId: row!.id,
    type: "device.registered",
    message: "Edge device registered.",
    details: { scopes: input.scopes ?? null },
  });
  return { deviceId: row!.id, name: row!.name, secret };
}

export async function revokeEdgeDevice(id: string): Promise<void> {
  await ensureEdgeSchema();
  await getDb()
    .update(edgeDevice)
    .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date(), currentJobId: null })
    .where(eq(edgeDevice.id, id));
  await logEdgeEvent({ deviceId: id, level: "warning", type: "device.revoked", message: "Edge device revoked." });
}

export async function listEdgeDashboard() {
  await ensureEdgeSchema();
  const db = getDb();
  const [devices, jobs, events, sources] = await Promise.all([
    db.select({
      id: edgeDevice.id,
      name: edgeDevice.name,
      status: edgeDevice.status,
      scopes: edgeDevice.scopes,
      version: edgeDevice.version,
      currentJobId: edgeDevice.currentJobId,
      lastSeenAt: edgeDevice.lastSeenAt,
      revokedAt: edgeDevice.revokedAt,
      createdAt: edgeDevice.createdAt,
    }).from(edgeDevice).orderBy(desc(edgeDevice.createdAt)).limit(50),
    db.select({
      id: crawlJob.id,
      sourceId: crawlJob.sourceId,
      status: crawlJob.status,
      priority: crawlJob.priority,
      leaseDeviceId: crawlJob.leaseDeviceId,
      leaseExpiresAt: crawlJob.leaseExpiresAt,
      attempts: crawlJob.attempts,
      pagesSubmitted: crawlJob.pagesSubmitted,
      itemsSubmitted: crawlJob.itemsSubmitted,
      signalsNew: crawlJob.signalsNew,
      signalsDuplicate: crawlJob.signalsDuplicate,
      observationsCreated: crawlJob.observationsCreated,
      error: crawlJob.error,
      createdAt: crawlJob.createdAt,
      updatedAt: crawlJob.updatedAt,
      finishedAt: crawlJob.finishedAt,
    }).from(crawlJob).orderBy(desc(crawlJob.createdAt)).limit(50),
    db.select({
      id: edgeDeviceEvent.id,
      deviceId: edgeDeviceEvent.deviceId,
      jobId: edgeDeviceEvent.jobId,
      level: edgeDeviceEvent.level,
      type: edgeDeviceEvent.type,
      message: edgeDeviceEvent.message,
      details: edgeDeviceEvent.details,
      createdAt: edgeDeviceEvent.createdAt,
    }).from(edgeDeviceEvent).orderBy(desc(edgeDeviceEvent.createdAt)).limit(80),
    db.select({
      id: collectionSource.id,
      label: collectionSource.label,
      url: collectionSource.url,
      enabled: collectionSource.enabled,
    }).from(collectionSource).orderBy(desc(collectionSource.createdAt)).limit(100),
  ]);
  return { devices, jobs, events, sources };
}

export async function enqueueEdgeCrawlJob(input: z.infer<typeof EnqueueJobInput>): Promise<{ jobId: string }> {
  await ensureEdgeSchema();
  const db = getDb();
  const source = await db.query.collectionSource.findFirst({ where: eq(collectionSource.id, input.sourceId) });
  if (!source) throw badRequest("collection source not found");
  const payload = {
    mode: "playwright_edge",
    source: {
      id: source.id,
      label: source.label,
      url: source.url,
      kind: source.kind,
      config: source.config,
    },
  };
  const [row] = await db
    .insert(crawlJob)
    .values({ sourceId: source.id, payload, priority: input.priority ?? 0 })
    .returning({ id: crawlJob.id });
  await logEdgeEvent({
    jobId: row!.id,
    type: "job.enqueued",
    message: `Queued edge crawl for ${source.label}.`,
    details: { sourceId: source.id, url: source.url },
  });
  return { jobId: row!.id };
}

export async function authenticateEdgeRequest<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ device: AuthenticatedDevice; body: T }> {
  await ensureEdgeSchema();
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw badRequest("request body too large");

  const deviceId = req.headers.get(EDGE_AUTH_HEADERS.deviceId);
  const timestamp = req.headers.get(EDGE_AUTH_HEADERS.timestamp);
  const nonce = req.headers.get(EDGE_AUTH_HEADERS.nonce);
  const signature = req.headers.get(EDGE_AUTH_HEADERS.signature);
  if (!deviceId || !timestamp || !nonce || !signature) throw unauthorized("missing edge auth headers");
  if (!/^[a-zA-Z0-9_-]{12,160}$/.test(nonce)) throw unauthorized("invalid edge nonce");

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > CLOCK_SKEW_MS) {
    throw unauthorized("stale edge request");
  }

  const db = getDb();
  const device = await db.query.edgeDevice.findFirst({ where: eq(edgeDevice.id, deviceId) }) as AuthenticatedDevice | undefined;
  if (!device || device.status !== "active") throw unauthorized("edge device is not active");

  const path = new URL(req.url).pathname;
  const expected = signWithDeviceKey({
    key: device.tokenHash,
    method: req.method,
    path,
    timestamp,
    nonce,
    body: text,
  });
  if (!verifyEdgeSignature(expected, signature)) throw unauthorized("invalid edge signature");

  const insertedNonce = await db
    .insert(edgeDeviceNonce)
    .values({ deviceId: device.id, nonce })
    .onConflictDoNothing({ target: [edgeDeviceNonce.deviceId, edgeDeviceNonce.nonce] })
    .returning({ id: edgeDeviceNonce.id });
  if (insertedNonce.length === 0) throw unauthorized("replayed edge request");

  const json = text ? parseSignedJson(text) : {};
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw badRequest("invalid request body", parsed.error.flatten());
  return { device, body: parsed.data };
}

export async function recordHeartbeat(device: AuthenticatedDevice, input: z.infer<typeof HeartbeatInput>) {
  await ensureEdgeSchema();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + HEARTBEAT_LEASE_EXTENSION_SECONDS * 1000);
  await getDb()
    .update(edgeDevice)
    .set({
      version: input.version ?? device.version ?? null,
      currentJobId: input.currentJobId ?? null,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(edgeDevice.id, device.id));
  if (input.currentJobId) {
    const job = await getDb().query.crawlJob.findFirst({ where: eq(crawlJob.id, input.currentJobId) });
    const status = job?.status === "needs_user_action" ? "needs_user_action" : "running";
    await getDb()
      .update(crawlJob)
      .set({ status, leaseExpiresAt, updatedAt: now })
      .where(and(
        eq(crawlJob.id, input.currentJobId),
        eq(crawlJob.leaseDeviceId, device.id),
        inArray(crawlJob.status, ["leased", "running", "needs_user_action"]),
      ));
  }
  return { ok: true };
}

export async function leaseNextJob(device: AuthenticatedDevice, input: z.infer<typeof LeaseInput>) {
  await ensureEdgeSchema();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseSeconds ?? DEFAULT_LEASE_SECONDS) * 1000);

  await expireStaleLeases(now);

  const leased = await transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(crawlJob)
      .where(or(
        eq(crawlJob.status, "queued"),
        eq(crawlJob.status, "expired"),
        and(
          eq(crawlJob.status, "needs_user_action"),
          isNull(crawlJob.leaseExpiresAt),
          sql`${crawlJob.attempts} < ${crawlJob.maxAttempts}`,
        ),
      ))
      .orderBy(desc(crawlJob.priority), crawlJob.createdAt)
      .limit(20);

    for (const candidate of candidates) {
      if (!deviceCanRunSource(device, candidate.sourceId)) continue;
      const [row] = await tx
        .update(crawlJob)
        .set({
          status: "leased",
          leaseDeviceId: device.id,
          leaseExpiresAt,
          attempts: sql`${crawlJob.attempts} + 1`,
          startedAt: candidate.startedAt ?? now,
          finishedAt: null,
          updatedAt: now,
          error: null,
        })
        .where(and(
          eq(crawlJob.id, candidate.id),
          or(
            inArray(crawlJob.status, ["queued", "expired"]),
            and(eq(crawlJob.status, "needs_user_action"), isNull(crawlJob.leaseExpiresAt)),
          ),
        ))
        .returning();
      if (row) return row;
    }
    return null;
  });

  await getDb()
    .update(edgeDevice)
    .set({
      version: input.version ?? device.version ?? null,
      currentJobId: leased?.id ?? null,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(edgeDevice.id, device.id));

  if (!leased) return { job: null };
  await logEdgeEvent({
    deviceId: device.id,
    jobId: leased.id,
    type: "job.leased",
    message: "Crawl job leased to edge device.",
    details: { leaseExpiresAt: leaseExpiresAt.toISOString() },
  });
  return {
    job: {
      id: leased.id,
      sourceId: leased.sourceId,
      payload: leased.payload,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    },
  };
}

export async function submitJobResults(
  device: AuthenticatedDevice,
  jobId: string,
  input: z.infer<typeof SubmitResultsInput>,
) {
  await ensureEdgeSchema();
  const job = await getActiveJobForDevice(device, jobId);
  const allowedDomains = await allowedDomainsForSource(job.sourceId);
  const pageIds = new Map<string, string>();
  const now = new Date();
  let pagesAccepted = 0;
  let itemsAccepted = 0;
  let signalsNew = 0;
  let signalsDuplicate = 0;
  let observationsCreated = 0;

  for (const page of input.pages) {
    assertAllowedUrl(page.canonicalUrl, allowedDomains);
    const [row] = await getDb()
      .insert(crawlResultPage)
      .values({
        jobId,
        deviceId: device.id,
        canonicalUrl: page.canonicalUrl,
        status: page.status,
        httpStatus: page.httpStatus ?? null,
        contentHash: page.contentHash ?? null,
        textHash: page.textHash ?? null,
        fetchDurationMs: page.fetchDurationMs ?? null,
        bytesFetched: page.bytesFetched ?? 0,
        textLength: page.textLength ?? 0,
        itemCount: page.itemCount ?? 0,
        error: page.error ?? null,
        fetchedAt: page.fetchedAt ? new Date(page.fetchedAt) : now,
      })
      .onConflictDoUpdate({
        target: [crawlResultPage.jobId, crawlResultPage.canonicalUrl],
        set: {
          status: page.status,
          httpStatus: page.httpStatus ?? null,
          contentHash: page.contentHash ?? null,
          textHash: page.textHash ?? null,
          fetchDurationMs: page.fetchDurationMs ?? null,
          bytesFetched: page.bytesFetched ?? 0,
          textLength: page.textLength ?? 0,
          itemCount: page.itemCount ?? 0,
          error: page.error ?? null,
          fetchedAt: page.fetchedAt ? new Date(page.fetchedAt) : now,
        },
      })
      .returning({ id: crawlResultPage.id });
    pagesAccepted++;
    pageIds.set(page.canonicalUrl, row!.id);
  }

  for (const item of input.items) {
    if (item.pageUrl) assertAllowedUrl(item.pageUrl, allowedDomains);
    if (looksLikeUrl(item.sourceRef)) assertAllowedUrl(item.sourceRef, allowedDomains);
    const submittedSourceRef = item.sourceRef;
    const signalSourceRef = sourceRefForSignal({
      sourceType: item.sourceType,
      sourceRef: item.sourceRef,
      pageUrl: item.pageUrl ?? null,
    });
    if (looksLikeUrl(signalSourceRef)) assertAllowedUrl(signalSourceRef, allowedDomains);
    const existingItem = await getDb().query.crawlResultItem.findFirst({
      columns: { id: true },
      where: (t, { and, eq }) => and(eq(t.jobId, jobId), eq(t.sourceRef, submittedSourceRef)),
    });
    if (existingItem) continue;

    const existingSignal = await getDb().query.rawSignal.findFirst({
      columns: { id: true },
      where: (s, { and, eq }) => and(eq(s.sourceType, item.sourceType), eq(s.sourceRef, signalSourceRef)),
    });
    if (existingSignal) {
      const inserted = await getDb()
        .insert(crawlResultItem)
        .values({
          jobId,
          pageId: item.pageUrl ? pageIds.get(item.pageUrl) ?? null : null,
          deviceId: device.id,
          sourceRef: submittedSourceRef,
          pageUrl: item.pageUrl ?? null,
          sourceType: item.sourceType,
          rawText: item.text,
          capturedAt: item.capturedAt ? new Date(item.capturedAt) : now,
          rawSignalId: existingSignal.id,
          duplicate: true,
          observationsCreated: 0,
        })
        .onConflictDoNothing({ target: [crawlResultItem.jobId, crawlResultItem.sourceRef] })
        .returning({ id: crawlResultItem.id });
      if (inserted.length === 0) continue;
      itemsAccepted++;
      signalsDuplicate++;
      continue;
    }
    const distilledText = await distillEdgePost({
      rawText: item.text,
      sourceRef: signalSourceRef,
      pageUrl: item.pageUrl ?? null,
    });
    const ingest = await ingestSignal({
      rawText: distilledText,
      extractionText: distilledText,
      sourceType: item.sourceType,
      sourceRef: signalSourceRef,
      capturedAt: item.capturedAt ? new Date(item.capturedAt) : now,
    });
    const pageId = item.pageUrl ? pageIds.get(item.pageUrl) ?? null : null;
    const inserted = await getDb()
      .insert(crawlResultItem)
      .values({
        jobId,
        pageId,
        deviceId: device.id,
        sourceRef: submittedSourceRef,
        pageUrl: item.pageUrl ?? null,
        sourceType: item.sourceType,
        rawText: item.text,
        capturedAt: item.capturedAt ? new Date(item.capturedAt) : now,
        rawSignalId: ingest.rawSignalId,
        duplicate: ingest.duplicate,
        observationsCreated: ingest.observationsCreated,
      })
      .onConflictDoNothing({ target: [crawlResultItem.jobId, crawlResultItem.sourceRef] })
      .returning({ id: crawlResultItem.id });
    if (inserted.length === 0) continue;
    itemsAccepted++;
    if (ingest.duplicate) signalsDuplicate++;
    else signalsNew++;
    observationsCreated += ingest.observationsCreated;
  }

  await getDb()
    .update(crawlJob)
    .set({
      status: "running",
      pagesSubmitted: sql`${crawlJob.pagesSubmitted} + ${pagesAccepted}`,
      itemsSubmitted: sql`${crawlJob.itemsSubmitted} + ${itemsAccepted}`,
      signalsNew: sql`${crawlJob.signalsNew} + ${signalsNew}`,
      signalsDuplicate: sql`${crawlJob.signalsDuplicate} + ${signalsDuplicate}`,
      observationsCreated: sql`${crawlJob.observationsCreated} + ${observationsCreated}`,
      updatedAt: now,
    })
    .where(eq(crawlJob.id, jobId));

  await logEdgeEvent({
    deviceId: device.id,
    jobId,
    type: "job.results",
    message: "Edge device submitted crawl results.",
    details: { pagesAccepted, itemsAccepted, signalsNew, signalsDuplicate, observationsCreated },
  });
  return { pagesAccepted, itemsAccepted, signalsNew, signalsDuplicate, observationsCreated };
}

export async function reportJobUserAction(
  device: AuthenticatedDevice,
  jobId: string,
  input: z.infer<typeof UserActionInput>,
) {
  await ensureEdgeSchema();
  await getActiveJobForDevice(device, jobId);
  const now = new Date();
  const leaseExpiresAt = input.solveDeadlineAt ? new Date(input.solveDeadlineAt) : new Date(now.getTime() + HEARTBEAT_LEASE_EXTENSION_SECONDS * 1000);
  await getDb()
    .update(crawlJob)
    .set({
      status: "needs_user_action",
      error: input.reason,
      leaseExpiresAt,
      updatedAt: now,
    })
    .where(eq(crawlJob.id, jobId));
  await logEdgeEvent({
    deviceId: device.id,
    jobId,
    level: "warning",
    type: "job.user_action_required",
    message: "Crawler is waiting for browser verification.",
    details: {
      url: input.url,
      reason: input.reason,
      remoteBrowserUrl: input.remoteBrowserUrl ?? null,
      solveDeadlineAt: input.solveDeadlineAt ?? leaseExpiresAt.toISOString(),
    },
  });
  return { ok: true };
}

export async function completeJob(
  device: AuthenticatedDevice,
  jobId: string,
  input: z.infer<typeof CompleteJobInput>,
) {
  await ensureEdgeSchema();
  const job = await getActiveJobForDevice(device, jobId);
  const finishedAt = new Date();
  const waitingForUser = input.status === "needs_user_action";
  await getDb()
    .update(crawlJob)
    .set({
      status: input.status,
      error: input.error ?? null,
      metrics: input.metrics ?? null,
      leaseDeviceId: waitingForUser ? null : job.leaseDeviceId,
      finishedAt: waitingForUser ? null : finishedAt,
      updatedAt: finishedAt,
      leaseExpiresAt: null,
    })
    .where(eq(crawlJob.id, jobId));
  await getDb()
    .update(edgeDevice)
    .set({ currentJobId: null, lastSeenAt: finishedAt, updatedAt: finishedAt })
    .where(eq(edgeDevice.id, device.id));
  await getDb()
    .update(collectionSource)
    .set({
      lastRunAt: finishedAt,
      lastStatus: input.status === "succeeded" ? "ok" : "error",
      lastError: input.status === "succeeded" ? null : input.error ?? input.status,
      lastItemCount: job.itemsSubmitted,
    })
    .where(eq(collectionSource.id, job.sourceId));
  await logEdgeEvent({
    deviceId: device.id,
    jobId,
    level: input.status === "succeeded" ? "info" : "warning",
    type: `job.${input.status}`,
    message: input.status === "succeeded" ? "Crawl job completed." : "Crawl job stopped before completion.",
    details: { error: input.error ?? null, metrics: input.metrics ?? null },
  });
  return { ok: true };
}

async function getActiveJobForDevice(device: AuthenticatedDevice, jobId: string) {
  const job = await getDb().query.crawlJob.findFirst({ where: eq(crawlJob.id, jobId) });
  if (!job) throw badRequest("crawl job not found");
  if (job.leaseDeviceId !== device.id || !["leased", "running", "needs_user_action"].includes(job.status)) {
    throw unauthorized("crawl job is not leased to this device");
  }
  if (job.leaseExpiresAt && job.leaseExpiresAt.getTime() < Date.now()) {
    throw unauthorized("crawl job lease expired");
  }
  return job;
}

async function expireStaleLeases(now: Date): Promise<void> {
  await getDb()
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

async function allowedDomainsForSource(sourceId: string): Promise<string[]> {
  const source = await getDb().query.collectionSource.findFirst({ where: eq(collectionSource.id, sourceId) });
  if (!source) throw badRequest("collection source not found");
  const domains = new Set<string>([new URL(source.url).hostname.toLowerCase()]);
  if (source.config && typeof source.config === "object" && !Array.isArray(source.config)) {
    const raw = (source.config as Record<string, unknown>).allowedDomains;
    if (Array.isArray(raw)) {
      for (const value of raw) if (typeof value === "string" && value.trim()) domains.add(normalizeHost(value));
    }
  }
  return [...domains];
}

function deviceCanRunSource(device: AuthenticatedDevice, sourceId: string): boolean {
  const scopes = DeviceScopes.safeParse(device.scopes);
  const sourceIds = scopes.success ? scopes.data.sourceIds : undefined;
  return !sourceIds || sourceIds.length === 0 || sourceIds.includes(sourceId);
}

function assertAllowedUrl(raw: string, allowedDomains: string[]): void {
  const host = new URL(raw).hostname.toLowerCase();
  if (!allowedDomains.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    throw badRequest("submitted URL is outside the source allowlist", { url: raw, allowedDomains });
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function sourceRefForSignal(input: { sourceType: string; sourceRef: string; pageUrl?: string | null }): string {
  if (input.sourceType !== "web") return input.sourceRef;
  if (looksLikeUrl(input.sourceRef)) return input.sourceRef;
  if (!input.pageUrl) return input.sourceRef;
  return `${input.pageUrl}#item=${sha256Hex(input.sourceRef).slice(0, 12)}`;
}

function normalizeHost(value: string): string {
  return value.replace(/^https?:\/\//i, "").split("/")[0]!.trim().toLowerCase();
}

function parseSignedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("invalid request body");
  }
}

async function logEdgeEvent(input: {
  deviceId?: string | null;
  jobId?: string | null;
  level?: "info" | "warning" | "error";
  type: string;
  message: string;
  details?: unknown;
}, db: DbExecutor = getDb()): Promise<void> {
  await db.insert(edgeDeviceEvent).values({
    deviceId: input.deviceId ?? null,
    jobId: input.jobId ?? null,
    level: input.level ?? "info",
    type: input.type,
    message: input.message,
    details: input.details ?? null,
  });
}

export function buildEdgeAuthHeaders(input: {
  deviceId: string;
  secret: string;
  method: string;
  path: string;
  body: string;
}): Record<string, string> {
  const timestamp = String(Date.now());
  const nonce = randomNonce();
  const key = sha256Hex(input.secret);
  const signature = signWithDeviceKey({
    key,
    method: input.method,
    path: input.path,
    timestamp,
    nonce,
    body: input.body,
  });
  return {
    [EDGE_AUTH_HEADERS.deviceId]: input.deviceId,
    [EDGE_AUTH_HEADERS.timestamp]: timestamp,
    [EDGE_AUTH_HEADERS.nonce]: nonce,
    [EDGE_AUTH_HEADERS.signature]: signature,
    "content-type": "application/json",
  };
}

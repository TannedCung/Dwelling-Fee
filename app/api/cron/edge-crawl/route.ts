import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, route, unauthorized } from "../../../../lib/api/respond";
import type { Logger } from "../../../../lib/log";
import { enqueueScheduledEdgeCrawlJobs, ScheduledEdgeCrawlInput } from "../../../../lib/edge/scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const QueryInput = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  priority: z.coerce.number().int().min(0).max(100).optional(),
});

async function handleScheduledEdgeCrawl(req: Request, _ctx: unknown, log: Logger) {
  assertCronAuthorized(req);
  const params = new URL(req.url).searchParams;
  const parsed = QueryInput.safeParse({
    limit: params.get("limit") ?? undefined,
    priority: params.get("priority") ?? undefined,
  });
  if (!parsed.success) throw badRequest("invalid cron query", parsed.error.flatten());

  const input = ScheduledEdgeCrawlInput.parse(parsed.data);
  const result = await enqueueScheduledEdgeCrawlJobs(input);
  log.info("scheduled edge crawl jobs enqueued", result);
  return NextResponse.json({ ok: true, ...result });
}

export const GET = route("cron.edge_crawl", handleScheduledEdgeCrawl);
export const POST = route("cron.edge_crawl", handleScheduledEdgeCrawl);

function assertCronAuthorized(req: Request): void {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) throw unauthorized();

  const token = authorization.slice("Bearer ".length);
  if (!constantTimeEqual(token, secret)) throw unauthorized();
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

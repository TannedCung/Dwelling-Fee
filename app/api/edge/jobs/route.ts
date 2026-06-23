import { NextResponse } from "next/server";
import { parseBody, route } from "../../../../lib/api/respond";
import { EnqueueJobInput, enqueueEdgeCrawlJob } from "../../../../lib/edge/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route("edge.jobs.enqueue", async (req, _ctx, log) => {
  const body = await parseBody(req, EnqueueJobInput);
  const result = await enqueueEdgeCrawlJob(body);
  log.info("edge crawl job enqueued", result);
  return NextResponse.json(result);
});

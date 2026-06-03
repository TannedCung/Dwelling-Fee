import { NextResponse } from "next/server";
import { runDueSources } from "../../../../lib/collection";
import { route, unauthorized } from "../../../../lib/api/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scheduled collection entrypoint (configured in vercel.json crons). Vercel sends
 * `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set — we require it so
 * the endpoint can't be triggered by the public. When CRON_SECRET is unset (local
 * dev), auth is skipped.
 */
export const GET = route("cron.collect", async (req, _ctx, log) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    throw unauthorized();
  }
  const result = await runDueSources();
  const failed = result.runs.filter((r) => r.status === "error").length;
  log.info("scheduled collection complete", { sources: result.runs.length, failed });
  return NextResponse.json(result);
});

import { NextResponse } from "next/server";
import { geocodeMissing } from "../../../../lib/geo/backfill";
import { route } from "../../../../lib/api/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60; // geocoding is rate-limited (≤1 req/s), so allow headroom

export const POST = route("geo.backfill", async (_req, _ctx, log) => {
  const result = await geocodeMissing(5);
  log.info("geocode backfill", { geocoded: result.geocoded, failed: result.failed, remaining: result.remaining });
  return NextResponse.json(result);
});

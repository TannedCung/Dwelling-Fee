import { NextResponse } from "next/server";
import { geocodeMissing } from "../../../../lib/geo/backfill";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60; // geocoding is rate-limited (≤1 req/s), so allow headroom

export async function POST() {
  try {
    const result = await geocodeMissing(5);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "geocode failed" }, { status: 500 });
  }
}

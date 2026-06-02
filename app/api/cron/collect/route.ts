import { NextResponse } from "next/server";
import { runDueSources } from "../../../../lib/collection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scheduled collection entrypoint (configured in vercel.json crons). Vercel sends
 * `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set — we require it so
 * the endpoint can't be triggered by the public. When CRON_SECRET is unset (local
 * dev), auth is skipped.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    return NextResponse.json(await runDueSources());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "collection failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { runSource, runDueSources } from "../../../lib/collection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ sourceId: z.string().uuid().optional() });

/** Manual collection trigger: run one source ({sourceId}) or all enabled sources. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    if (parsed.data.sourceId) {
      const summary = await runSource(parsed.data.sourceId);
      return NextResponse.json({ runs: [summary] });
    }
    return NextResponse.json(await runDueSources());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "collection failed" }, { status: 500 });
  }
}

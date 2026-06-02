import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestSignal } from "../../../lib/ingest";

// Touches the DB + Claude API per request — never statically optimized.
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // PostGIS/pgvector + node:crypto need the Node runtime

const Body = z.object({
  rawText: z.string().min(1, "rawText is required"),
  sourceType: z.enum(["broker", "web", "agent", "user"]).optional(),
  sourceRef: z.string().nullish(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const result = await ingestSignal(parsed.data);
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "ingest failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

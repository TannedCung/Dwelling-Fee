import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "../../../../lib/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ sourceType: z.enum(["broker", "web", "agent", "user"]).optional() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const sourceType = parsed.success ? parsed.data.sourceType : undefined;
  try {
    const id = await createSession(sourceType);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

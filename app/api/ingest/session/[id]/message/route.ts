import { NextResponse } from "next/server";
import { z } from "zod";
import { runTurn } from "../../../../../../lib/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ content: z.string().min(1, "content is required") });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const result = await runTurn(id, parsed.data.content);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "turn failed" }, { status: 500 });
  }
}

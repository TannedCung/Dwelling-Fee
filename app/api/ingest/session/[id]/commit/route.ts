import { NextResponse } from "next/server";
import { commitSession } from "../../../../../../lib/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const result = await commitSession(id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "commit failed" }, { status: 500 });
  }
}

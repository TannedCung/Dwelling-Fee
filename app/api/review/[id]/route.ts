import { NextResponse } from "next/server";
import { z } from "zod";
import { applyReview } from "../../../../lib/review";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), propertyId: z.string().uuid() }),
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("dismiss") }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    await applyReview(id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "review failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

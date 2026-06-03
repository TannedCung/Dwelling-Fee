import { NextResponse } from "next/server";
import { z } from "zod";
import { applyReview } from "../../../../lib/review";
import { route, parseBody } from "../../../../lib/api/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), propertyId: z.string().uuid() }),
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("dismiss") }),
]);

export const POST = route<{ params: Promise<{ id: string }> }>("review.apply", async (req, ctx, log) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, Body);
  await applyReview(id, body);
  log.info("review applied", { observationId: id, action: body.action });
  return NextResponse.json({ ok: true });
});

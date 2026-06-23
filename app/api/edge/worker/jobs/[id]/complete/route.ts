import { NextResponse } from "next/server";
import { route } from "../../../../../../../lib/api/respond";
import { CompleteJobInput, authenticateEdgeRequest, completeJob } from "../../../../../../../lib/edge/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route<{ params: Promise<{ id: string }> }>("edge.worker.jobs.complete", async (req, ctx) => {
  const { id } = await ctx.params;
  const { device, body } = await authenticateEdgeRequest(req, CompleteJobInput);
  return NextResponse.json(await completeJob(device, id, body));
});

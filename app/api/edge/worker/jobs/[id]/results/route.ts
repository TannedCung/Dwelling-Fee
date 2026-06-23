import { NextResponse } from "next/server";
import { route } from "../../../../../../../lib/api/respond";
import { SubmitResultsInput, authenticateEdgeRequest, submitJobResults } from "../../../../../../../lib/edge/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = route<{ params: Promise<{ id: string }> }>("edge.worker.jobs.results", async (req, ctx) => {
  const { id } = await ctx.params;
  const { device, body } = await authenticateEdgeRequest(req, SubmitResultsInput);
  return NextResponse.json(await submitJobResults(device, id, {
    pages: body.pages ?? [],
    items: (body.items ?? []).map((item) => ({ ...item, sourceType: item.sourceType ?? "web" })),
  }));
});

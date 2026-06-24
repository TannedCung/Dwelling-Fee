import { NextResponse } from "next/server";
import { route } from "../../../../../../../lib/api/respond";
import { UserActionInput, authenticateEdgeRequest, reportJobUserAction } from "../../../../../../../lib/edge/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route<{ params: Promise<{ id: string }> }>("edge.worker.jobs.user_action", async (req, ctx) => {
  const { id } = await ctx.params;
  const { device, body } = await authenticateEdgeRequest(req, UserActionInput);
  return NextResponse.json(await reportJobUserAction(device, id, body));
});

import { NextResponse } from "next/server";
import { route } from "../../../../../../lib/api/respond";
import { LeaseInput, authenticateEdgeRequest, leaseNextJob } from "../../../../../../lib/edge/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route("edge.worker.jobs.lease", async (req) => {
  const { device, body } = await authenticateEdgeRequest(req, LeaseInput);
  return NextResponse.json(await leaseNextJob(device, body));
});

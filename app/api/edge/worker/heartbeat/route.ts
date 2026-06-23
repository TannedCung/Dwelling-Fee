import { NextResponse } from "next/server";
import { route } from "../../../../../lib/api/respond";
import { HeartbeatInput, authenticateEdgeRequest, recordHeartbeat } from "../../../../../lib/edge/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route("edge.worker.heartbeat", async (req) => {
  const { device, body } = await authenticateEdgeRequest(req, HeartbeatInput);
  return NextResponse.json(await recordHeartbeat(device, body));
});

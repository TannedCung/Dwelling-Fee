import { NextResponse } from "next/server";
import { badRequest, route } from "../../../../../lib/api/respond";
import { getVncSessionByToken } from "../../../../../lib/edge/vnc-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route("edge.worker.vnc_tunnel.status", async (req) => {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token) {
    throw badRequest("Missing token parameter.");
  }

  const session = getVncSessionByToken(token);
  if (!session) {
    throw badRequest("Invalid or expired VNC session token.");
  }

  return NextResponse.json({
    ok: true,
    sessionId: session.id,
    deviceId: session.deviceId,
    jobId: session.jobId,
    status: session.status,
    expiresAt: session.expiresAt.toISOString(),
  });
});

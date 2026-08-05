import { NextResponse } from "next/server";
import { auth, isAllowedEmail } from "../../../../auth";
import { badRequest, route, unauthorized } from "../../../../lib/api/respond";
import { getVncSessionByToken } from "../../../../lib/edge/vnc-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route("admin.vnc_proxy.status", async (req) => {
  const session = await auth();
  if (!session?.user?.email || !isAllowedEmail(session.user.email)) {
    throw unauthorized("Admin authorization required.");
  }

  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token) {
    throw badRequest("Missing token parameter.");
  }

  const vncSession = getVncSessionByToken(token);
  if (!vncSession) {
    throw badRequest("Invalid or expired VNC session token.");
  }

  return NextResponse.json({
    ok: true,
    sessionId: vncSession.id,
    deviceId: vncSession.deviceId,
    jobId: vncSession.jobId,
    status: vncSession.status,
    expiresAt: vncSession.expiresAt.toISOString(),
  });
});

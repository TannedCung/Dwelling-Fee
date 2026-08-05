import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "../../../../../lib/api/respond";
import { authenticateEdgeRequest } from "../../../../../lib/edge/service";
import { createVncSession } from "../../../../../lib/edge/vnc-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CreateVncSessionInput = z.object({
  jobId: z.string().uuid(),
  ttlMs: z.number().int().min(10_000).max(1_800_000).optional(),
});

export const POST = route("edge.worker.vnc_session.create", async (req) => {
  const { device, body } = await authenticateEdgeRequest(req, CreateVncSessionInput);
  const session = createVncSession({
    deviceId: device.id,
    jobId: body.jobId,
    ttlMs: body.ttlMs,
  });

  return NextResponse.json({
    token: session.rawToken,
    expiresAt: session.expiresAt.toISOString(),
  });
});

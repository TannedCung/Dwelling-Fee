import { NextResponse } from "next/server";
import { revokeEdgeDevice } from "../../../../../../lib/edge/service";
import { route } from "../../../../../../lib/api/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route<{ params: Promise<{ id: string }> }>("edge.devices.revoke", async (_req, ctx, log) => {
  const { id } = await ctx.params;
  await revokeEdgeDevice(id);
  log.info("edge device revoked", { deviceId: id });
  return NextResponse.json({ ok: true });
});

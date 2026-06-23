import { NextResponse } from "next/server";
import { parseBody, route } from "../../../../lib/api/respond";
import { RegisterDeviceInput, registerEdgeDevice } from "../../../../lib/edge/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route("edge.devices.register", async (req, _ctx, log) => {
  const body = await parseBody(req, RegisterDeviceInput);
  const result = await registerEdgeDevice(body);
  log.info("edge device registered", { deviceId: result.deviceId });
  return NextResponse.json(result);
});

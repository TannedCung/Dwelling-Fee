import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "../../../../lib/ingest";
import { route } from "../../../../lib/api/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ sourceType: z.enum(["broker", "web", "agent", "user"]).optional() });

export const POST = route("ingest.session.create", async (req, _ctx, log) => {
  // Body is optional here — default to an empty object when absent/malformed.
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const sourceType = parsed.success ? parsed.data.sourceType : undefined;
  const id = await createSession(sourceType);
  log.info("session created", { sessionId: id, sourceType: sourceType ?? "broker" });
  return NextResponse.json({ id }, { status: 201 });
});

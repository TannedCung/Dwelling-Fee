import { NextResponse } from "next/server";
import { commitSession } from "../../../../../../lib/ingest";
import { route } from "../../../../../../lib/api/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route<{ params: Promise<{ id: string }> }>(
  "ingest.session.commit",
  async (_req, ctx, log) => {
    const { id } = await ctx.params;
    const result = await commitSession(id);
    log.info("session committed", { sessionId: id, observationsCreated: result.observationsCreated });
    return NextResponse.json(result);
  },
);

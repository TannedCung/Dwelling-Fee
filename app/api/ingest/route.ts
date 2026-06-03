import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestSignal } from "../../../lib/ingest";
import { route, parseBody } from "../../../lib/api/respond";

// Touches the DB + Claude API per request — never statically optimized.
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // PostGIS/pgvector + node:crypto need the Node runtime

const Body = z.object({
  rawText: z.string().min(1, "rawText is required"),
  sourceType: z.enum(["broker", "web", "agent", "user"]).optional(),
  sourceRef: z.string().nullish(),
});

export const POST = route("ingest.signal", async (req, _ctx, log) => {
  const body = await parseBody(req, Body);
  const result = await ingestSignal(body);
  log.info("ingested signal", {
    rawSignalId: result.rawSignalId,
    duplicate: result.duplicate,
    observationsCreated: result.observationsCreated,
  });
  return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
});

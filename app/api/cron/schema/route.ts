import { NextResponse } from "next/server";
import { ensurePropertyHierarchySchema } from "../../../../lib/db/ensure-schema";
import { route, unauthorized } from "../../../../lib/api/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = route("cron.schema", async (req, _ctx, log) => {
  const secret = process.env.SCHEMA_MIGRATION_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    throw unauthorized();
  }

  const result = await ensurePropertyHierarchySchema();
  log.info("schema ensured", { applied: result.applied, missing: result.missing.length });
  return NextResponse.json({ ok: result.missing.length === 0, ...result });
});

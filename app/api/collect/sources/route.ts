import { NextResponse } from "next/server";
import { z } from "zod";
import { createSource, listSources, setEnabled } from "../../../../lib/collection";
import { route, parseBody } from "../../../../lib/api/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CreateBody = z.object({
  label: z.string().min(1, "label is required"),
  url: z.string().url("a valid url is required"),
  kind: z.enum(["stub", "http"]).optional(),
});

const PatchBody = z.object({ id: z.string().uuid(), enabled: z.boolean() });

export const GET = route("collect.sources.list", async () => {
  return NextResponse.json({ sources: await listSources() });
});

export const POST = route("collect.sources.create", async (req, _ctx, log) => {
  const body = await parseBody(req, CreateBody);
  const id = await createSource(body);
  log.info("collection source created", { sourceId: id, kind: body.kind ?? "stub" });
  return NextResponse.json({ id }, { status: 201 });
});

export const PATCH = route("collect.sources.update", async (req, _ctx, log) => {
  const body = await parseBody(req, PatchBody);
  await setEnabled(body.id, body.enabled);
  log.info("collection source toggled", { sourceId: body.id, enabled: body.enabled });
  return NextResponse.json({ ok: true });
});

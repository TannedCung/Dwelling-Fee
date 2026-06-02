import { NextResponse } from "next/server";
import { z } from "zod";
import { createSource, listSources, setEnabled } from "../../../../lib/collection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CreateBody = z.object({
  label: z.string().min(1, "label is required"),
  url: z.string().url("a valid url is required"),
  kind: z.enum(["stub", "http"]).optional(),
});

const PatchBody = z.object({ id: z.string().uuid(), enabled: z.boolean() });

export async function GET() {
  try {
    return NextResponse.json({ sources: await listSources() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const id = await createSource(parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    await setEnabled(parsed.data.id, parsed.data.enabled);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

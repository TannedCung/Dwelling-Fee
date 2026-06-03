import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestSignal } from "../../../lib/ingest";
import { badRequest, route, parseBody } from "../../../lib/api/respond";
import { uploadImageFiles, type Attachment } from "../../../lib/storage/r2";

// Touches the DB + Claude API per request — never statically optimized.
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // PostGIS/pgvector + node:crypto need the Node runtime

const Body = z.object({
  rawText: z.string().min(1, "rawText is required"),
  sourceType: z.enum(["broker", "web", "agent", "user"]).optional(),
  sourceRef: z.string().nullish(),
});

const SourceType = z.enum(["broker", "web", "agent", "user"]);

export const POST = route("ingest.signal", async (req, _ctx, log) => {
  const body = await parseSignalRequest(req);
  const result = await ingestSignal(body);
  log.info("ingested signal", {
    rawSignalId: result.rawSignalId,
    duplicate: result.duplicate,
    observationsCreated: result.observationsCreated,
  });
  return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
});

async function parseSignalRequest(req: Request): Promise<{
  rawText: string;
  sourceType?: "broker" | "web" | "agent" | "user";
  sourceRef?: string | null;
  attachments?: Attachment[];
}> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) return parseBody(req, Body);

  const form = await req.formData();
  const rawText = String(form.get("rawText") ?? "").trim();
  const sourceTypeRaw = form.get("sourceType");
  let sourceType: "broker" | "web" | "agent" | "user" | undefined;
  if (typeof sourceTypeRaw === "string" && sourceTypeRaw) {
    const parsed = SourceType.safeParse(sourceTypeRaw);
    if (!parsed.success) throw badRequest("invalid sourceType");
    sourceType = parsed.data;
  }
  const sourceRefRaw = form.get("sourceRef");
  const sourceRef = typeof sourceRefRaw === "string" && sourceRefRaw ? sourceRefRaw : null;
  const files = form.getAll("images").filter((v): v is File => v instanceof File);
  if (!rawText && files.length === 0) throw badRequest("rawText or at least one image is required");
  return { rawText, sourceType, sourceRef, attachments: await uploadImageFiles(files) };
}

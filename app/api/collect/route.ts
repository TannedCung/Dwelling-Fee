import { NextResponse } from "next/server";
import { z } from "zod";
import { previewSource, runSource, runDueSources } from "../../../lib/collection";
import { badRequest, route } from "../../../lib/api/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ sourceId: z.string().uuid().optional(), preview: z.boolean().optional() });

/** Manual collection trigger: run one source ({sourceId}) or all enabled sources. */
export const POST = route("collect.run", async (req, _ctx, log) => {
  // Body is optional — default to {} (run all enabled).
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const sourceId = parsed.success ? parsed.data.sourceId : undefined;
  const preview = parsed.success ? parsed.data.preview === true : false;
  if (preview) {
    if (!sourceId) throw badRequest("sourceId is required for preview");
    const result = await previewSource(sourceId);
    log.info("collection preview", { sourceId, pages: result.pages.length, items: result.items.length });
    return NextResponse.json({
      pages: result.pages,
      items: result.items.map((item) => ({
        sourceRef: item.sourceRef,
        pageUrl: item.pageUrl,
        sourceType: item.sourceType,
        capturedAt: item.capturedAt,
        text: item.text.slice(0, 4000),
      })),
    });
  }
  if (sourceId) {
    const summary = await runSource(sourceId);
    log.info("manual collection run", { ...summary });
    return NextResponse.json({ runs: [summary] });
  }
  const result = await runDueSources();
  log.info("manual collection run (all enabled)", { runs: result.runs.length });
  return NextResponse.json(result);
});

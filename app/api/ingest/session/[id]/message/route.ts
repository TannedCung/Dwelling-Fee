import { z } from "zod";
import { streamTurn } from "../../../../../../lib/ingest";
import { badRequest, route, parseBody } from "../../../../../../lib/api/respond";
import { uploadImageFiles, type Attachment } from "../../../../../../lib/storage/r2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ content: z.string().min(1, "content is required") });

/**
 * Conversational ingest turn, streamed as Server-Sent Events. Each `data:` line is
 * a JSON {@link import("../../../../../../lib/ingest").TurnEvent}:
 *   - {type:"partial", reply, draft}  — the reply filling in as the model writes
 *   - {type:"done", result}           — persisted draft + deterministic readiness
 *   - {type:"error", error}           — model/persistence failure mid-stream
 * Pre-stream failures (bad body) return a plain JSON error via the route() wrapper.
 */
export const POST = route<{ params: Promise<{ id: string }> }>(
  "ingest.session.message",
  async (req, ctx, log) => {
    const { id } = await ctx.params;
    const { content, attachments } = await parseMessageRequest(req);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        // Flush immediately, before the first model token (which can be several
        // seconds away). This opens the connection and stops proxies/CDNs from
        // buffering the response until enough bytes accumulate — the cause of
        // "typing dots, then the whole reply at once". The padding crosses any
        // byte-threshold buffers; SSE comment lines (":") are ignored by clients.
        controller.enqueue(encoder.encode(`:${" ".repeat(2048)}\n\n: open\n\n`));
        try {
          for await (const event of streamTurn(id, content, attachments)) {
            if (event.type === "error") log.error("turn failed mid-stream", undefined, { sessionId: id, detail: event.error });
            send(event);
          }
        } catch (e) {
          // Thrown around the generator (e.g. session not found/closed).
          log.error("turn failed", e, { sessionId: id });
          send({ type: "error", error: e instanceof Error ? e.message : "turn failed" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        // no-transform stops Vercel/CDN compression from buffering the body.
        "cache-control": "no-cache, no-transform",
        // Disable nginx-style proxy buffering so events flush immediately.
        "x-accel-buffering": "no",
        // NB: no `Connection` header — it's a forbidden hop-by-hop header on
        // HTTP/2 (how Vercel serves browsers) and can break the response.
      },
    });
  },
);

async function parseMessageRequest(req: Request): Promise<{ content: string; attachments: Attachment[] }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const content = String(form.get("content") ?? "").trim();
    const files = form.getAll("images").filter((v): v is File => v instanceof File);
    if (!content && files.length === 0) throw badRequest("content or at least one image is required");
    return { content, attachments: await uploadImageFiles(files) };
  }

  const { content } = await parseBody(req, Body); // throws 400 on bad body (pre-stream)
  return { content, attachments: [] };
}

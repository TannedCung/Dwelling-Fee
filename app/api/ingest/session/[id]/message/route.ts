import { z } from "zod";
import { streamTurn } from "../../../../../../lib/ingest";
import { route, parseBody } from "../../../../../../lib/api/respond";

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
    const { content } = await parseBody(req, Body); // throws 400 on bad body (pre-stream)

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        try {
          for await (const event of streamTurn(id, content)) {
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
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Disable proxy buffering so events flush immediately.
        "x-accel-buffering": "no",
      },
    });
  },
);

import { NextResponse } from "next/server";
import { z } from "zod";
import { streamTurn } from "../../../../../../lib/ingest";

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
 * Pre-stream failures (bad body, closed session) still return plain JSON errors.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        for await (const event of streamTurn(id, parsed.data.content)) {
          send(event);
        }
      } catch (e) {
        // Thrown before/around the generator (e.g. session not found/closed).
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
}

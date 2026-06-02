import { generateObject, type ModelMessage } from "ai";
import { z } from "zod";
import { getExtractionModel } from "../ai/registry";
import { PropertyExtraction } from "../extraction/schema";
import { getSession, addMessage, updateDraft } from "./session";

/**
 * One conversational ingest turn. The model receives the running transcript plus
 * the current draft and returns a reply + the FULL updated draft. Returning the
 * whole draft each turn (rather than incremental patches) keeps state coherent
 * and the schema validated by the AI SDK.
 */

const DraftTurn = z.object({
  reply: z
    .string()
    .describe("Short, friendly reply. Ask a clarifying question when price, area, or listing type is missing/ambiguous; otherwise confirm what changed."),
  properties: z
    .array(PropertyExtraction)
    .describe("The FULL updated draft reflecting everything known so far (not just the latest change). Empty if no property info yet."),
  readyToCommit: z
    .boolean()
    .describe("True only when every property has at least a price, or the user explicitly asked to save as-is."),
});

const SYSTEM = `You are an ingest assistant for a housing price intelligence database. You help a human turn messy broker messages and listings into clean, structured property records through a short conversation.

You maintain a DRAFT: a list of properties. Each turn, read the new user message together with the current draft, then update the draft and reply.

Decode Vietnamese real-estate shorthand (text may mix VI/EN):
- Price units: "tỷ"/"tỉ" = 1,000,000,000 VND; "triệu"/"tr" = 1,000,000 VND. "4.5 tỷ" -> 4500000000.
- "TL"/"thương lượng"/"thỏa thuận" -> negotiable. "PN"/"phòng ngủ" -> bedrooms. "m2"/"m²" -> areaM2.
- "sổ hồng"/"SHR"/"sổ đỏ" -> has title (a note; doesn't change price). "cho thuê" -> rent; "bán"/"cần bán" -> sale.
- "đã bán"/"chốt"/"sold" -> transacted; an active listing -> asking.
- A price written "/m2" means priceBasis="per_m2"; otherwise "total".

Rules:
- A single message may describe MULTIPLE properties — one draft entry each.
- Normalize priceVnd to an INTEGER of VND. Use null for genuinely-absent fields; NEVER invent prices or areas.
- When the user corrects something ("area is 80", "split into 2 units", "that's per m²"), apply it precisely and keep everything else.
- Be concise. Ask at most one or two clarifying questions per turn, and only when it materially affects the data.
- Lower confidence for partial/ambiguous properties.`;

export interface TurnResult {
  reply: string;
  draft: PropertyExtraction[];
  readyToCommit: boolean;
}

export async function runTurn(sessionId: string, userContent: string): Promise<TurnResult> {
  const before = await getSession(sessionId);
  if (!before) throw new Error("session not found");
  if (before.status !== "open") throw new Error("session is not open");

  // Persist the user turn first so it's never lost, even if the model call fails.
  await addMessage(sessionId, "user", userContent);

  const transcript: ModelMessage[] = [...before.messages, { role: "user" as const, content: userContent }].map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const system = `${SYSTEM}\n\nCURRENT DRAFT (JSON):\n${JSON.stringify(before.draft)}`;

  const { object } = await generateObject({
    model: getExtractionModel(),
    schema: DraftTurn,
    system,
    messages: transcript,
  });

  const title = before.title ?? deriveTitle(object.properties, userContent);
  await updateDraft(sessionId, object.properties, title);
  await addMessage(sessionId, "assistant", object.reply);

  return { reply: object.reply, draft: object.properties, readyToCommit: object.readyToCommit };
}

function deriveTitle(properties: PropertyExtraction[], fallback: string): string {
  const named = properties.find((p) => p.name)?.name;
  return (named ?? fallback).slice(0, 80);
}

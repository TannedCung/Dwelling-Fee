import { generateObject, streamObject, type ModelMessage } from "ai";
import { z } from "zod";
import { getExtractionModel } from "../ai/registry";
import { PropertyExtraction } from "../extraction/schema";
import { draftReady, incompleteSummary } from "../extraction/completeness";
import { getSession, addMessage, updateDraft, type SessionView } from "./session";
import type { Attachment } from "../storage/r2";

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
- If images are attached, read visible listing text/screenshots from those images and merge it with the typed message.

GOAL — gather enough to commit. A property is COMPLETE only when it has ALL of:
  1. price (priceVnd)
  2. price basis (total or per m²)
  3. listing type (sale or rent)
  4. area in m²
  5. an identity — a project/building name OR a location
Your job is to OBTAIN these by asking, not to settle for partial data.

Rules:
- A single message may describe MULTIPLE observations/listings — one draft entry each.
- Split identity into projectName -> buildingName/block -> houseNumber/unit.
- Do NOT create standalone properties from generic unit labels like "Căn 1", "Căn số 2", "Unit A1204", or "lô 5"; put those in houseNumber and ask for project/address if missing.
- Treat "nhà phố ABC", "shophouse ABC", and "ABC" as the same project/property identity. Use projectName="ABC"; put category words like "nhà phố" in tags and observed variants in aliases.
- Normalize priceVnd to an INTEGER of VND. Use null for genuinely-absent fields; NEVER invent prices, areas, or any required field to fill a gap.
- If a property is missing required fields, ASK the user a concise, specific question naming exactly what's needed (e.g. "What's the asking price and area for the Lumi unit?"). Ask only for what's required and still missing.
- If the user can't provide a required field or says to skip a property, REMOVE that property from the draft.
- When the user corrects something ("area is 80", "split into 2 units", "that's per m²"), apply it precisely and keep everything else.
- Only state that the draft is ready once EVERY property is complete. Never claim readiness while anything required is missing.
- Be concise: at most one or two questions per turn. Lower confidence for ambiguous properties.`;

export interface TurnResult {
  reply: string;
  draft: PropertyExtraction[];
  readyToCommit: boolean;
}

type DraftTurnObject = z.infer<typeof DraftTurn>;

/**
 * Shared turn setup: validate the session, persist the user message (so it's never
 * lost if the model call fails), and assemble the prompt. Used by both the one-shot
 * and streaming paths.
 */
async function prepareTurn(sessionId: string, userContent: string, attachments: Attachment[] = []) {
  const before = await getSession(sessionId);
  if (!before) throw new Error("session not found");
  if (before.status !== "open") throw new Error("session is not open");

  await addMessage(sessionId, "user", userContent, attachments);

  const transcript: ModelMessage[] = [
    ...before.messages,
    { role: "user" as const, content: userContent, attachments },
  ].map((m) => toModelMessage(m.role, m.content, m.attachments));

  const outstanding = incompleteSummary(before.draft);
  const system =
    `${SYSTEM}\n\nCURRENT DRAFT (JSON):\n${JSON.stringify(before.draft)}` +
    (outstanding.length ? `\n\nSTILL MISSING (ask for these):\n${outstanding.join("\n")}` : "");

  return { before, transcript, system };
}

/** Persist the model's result and apply the deterministic readiness gate. */
async function finalizeTurn(
  sessionId: string,
  before: SessionView,
  object: DraftTurnObject,
  userContent: string,
): Promise<TurnResult> {
  const title = before.title ?? deriveTitle(object.properties, userContent);
  await updateDraft(sessionId, object.properties, title);
  await addMessage(sessionId, "assistant", object.reply);
  // Readiness is a deterministic gate on required fields — not the model's opinion.
  return { reply: object.reply, draft: object.properties, readyToCommit: draftReady(object.properties) };
}

export async function runTurn(sessionId: string, userContent: string, attachments: Attachment[] = []): Promise<TurnResult> {
  const { before, transcript, system } = await prepareTurn(sessionId, userContent, attachments);
  const { object } = await generateObject({
    model: getExtractionModel(),
    schema: DraftTurn,
    system,
    messages: transcript,
  });
  return finalizeTurn(sessionId, before, object, userContent);
}

export type TurnEvent =
  | { type: "partial"; reply: string; draft: unknown }
  | { type: "done"; result: TurnResult }
  | { type: "error"; error: string };

/**
 * Streaming variant of {@link runTurn}. Yields incremental events as the model
 * produces them — the reply text fills in token-by-token (it's the first field in
 * the schema) — then persists and yields a final `done` event carrying the
 * validated draft and deterministic readiness flag.
 */
export async function* streamTurn(
  sessionId: string,
  userContent: string,
  attachments: Attachment[] = [],
): AsyncGenerator<TurnEvent> {
  const { before, transcript, system } = await prepareTurn(sessionId, userContent, attachments);

  const stream = streamObject({
    model: getExtractionModel(),
    schema: DraftTurn,
    system,
    messages: transcript,
  });

  try {
    for await (const partial of stream.partialObjectStream) {
      yield { type: "partial", reply: partial.reply ?? "", draft: partial.properties ?? [] };
    }
    const object = await stream.object; // validated; throws on schema mismatch
    const result = await finalizeTurn(sessionId, before, object, userContent);
    yield { type: "done", result };
  } catch (e) {
    yield { type: "error", error: e instanceof Error ? e.message : "turn failed" };
  }
}

function deriveTitle(properties: PropertyExtraction[], fallback: string): string {
  const named = properties.find((p) => p.projectName || p.name)?.projectName ?? properties.find((p) => p.name)?.name;
  return (named ?? fallback).slice(0, 80);
}

function toModelMessage(role: "user" | "assistant", content: string, attachments: Attachment[] = []): ModelMessage {
  if (role === "assistant" || attachments.length === 0) return { role, content };
  return {
    role: "user",
    content: [
      { type: "text", text: content || "Extract real-estate listing details from the attached image(s)." },
      ...attachments.map((a) => ({ type: "image" as const, image: new URL(a.url), mediaType: a.contentType })),
    ],
  };
}

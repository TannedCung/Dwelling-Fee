import { generateObject, streamObject, type ModelMessage } from "ai";
import { z } from "zod";
import { getExtractionModel } from "../ai/registry";
import { PropertyExtraction } from "../extraction/schema";
import { draftReady, incompleteSummary } from "../extraction/completeness";
import { getSession, addMessage, updateDraft, type SessionView } from "./session";
import { attachmentImageData, type Attachment } from "../storage/r2";
import { debugEvent, type IngestDebugEvent } from "./debug";
import { gatherIngestResearchContext, researchPromptBlock } from "./research";

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
- Approximate masked prices like "3.6x tỷ" or "3,6x tỉ" mean a low-precision total price near that amount; store the known lower-bound figure (e.g. 3600000000), lower confidence, and do not ask for exact digits unless the user needs exact pricing.
- "TL"/"thương lượng"/"thỏa thuận" -> negotiable. "PN"/"phòng ngủ" -> bedrooms. "m2"/"m²" -> areaM2.
- "sổ hồng"/"SHR"/"sổ đỏ" -> has title (a note; doesn't change price). "cho thuê" -> rent; "bán"/"cần bán" -> sale.
- If the text says "cần bán", "giá bán", "bán", or quotes a multi-billion VND price for an apartment, infer listingType="sale" unless rent is explicitly stated. Do not ask sale-vs-rent for implausible rent amounts such as 3.6 tỷ for a 58m² apartment.
- "đã bán"/"chốt"/"sold" -> transacted; an active listing -> asking.
- A price written "/m2" means priceBasis="per_m2"; otherwise "total".
- If images are attached, read visible listing text/screenshots from those images and merge it with the typed message.

GOAL — gather enough to commit. A property is COMPLETE only when it has ALL of:
  1. price (priceVnd)
  2. price basis (total or per m²)
  3. listing type (sale or rent)
  4. area in m²
  5. an identity — project -> building/block -> unit/house/lot when available, or a location for non-apartment homes
Your job is to OBTAIN these by asking, not to settle for partial data.

Rules:
- A single message may describe MULTIPLE observations/listings — one draft entry each.
- Split identity into projectName -> buildingName/block -> houseNumber/unit.
- For apartments, project/building alone is NOT the property. Ask for the unit/apartment/lot label when the user appears to be describing a specific listing.
- If the message identifies a project/building strongly enough and a unit number is absent, keep the project/building observation instead of asking which project it is. The committed observation can go to review for property-level attachment.
- If the user only knows a project/building-level market signal, keep the project/building fields and lower confidence; the observation will go to review rather than becoming a standalone property.
- Do NOT create standalone properties from generic unit labels like "Căn 1", "Căn số 2", "Unit A1204", or "lô 5"; put those in houseNumber and ask for project/address if missing.
- Treat "nhà phố ABC", "shophouse ABC", and "ABC" as the same project/property identity. Use projectName="ABC"; put category words like "nhà phố" in tags and observed variants in aliases.
- Normalize priceVnd to an INTEGER of VND. Use null for genuinely-absent fields; NEVER invent prices, areas, or any required field to fill a gap. Masked approximate prices are present, not absent.
- If a property is missing required fields, ASK the user a concise, specific question naming exactly what's needed (e.g. "What's the asking price and area for that unit?"). Ask only for what's required and still missing.
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
  const debug: IngestDebugEvent[] = [
    debugEvent("turn.start", "started", "Preparing ingest turn.", {
      sessionId,
      textLength: userContent.length,
      attachments: attachments.length,
      mockAi: process.env.MOCK_AI === "1",
    }),
  ];
  const before = await getSession(sessionId);
  if (!before) throw new Error("session not found");
  if (before.status !== "open") throw new Error("session is not open");

  await addMessage(sessionId, "user", userContent, attachments);

  const turns = [
    ...before.messages,
    { role: "user" as const, content: userContent, attachments },
  ];
  const messages = await Promise.all(turns.map((m) => toModelMessage(m.role, m.content, m.attachments)));

  const research = await gatherIngestResearchContext(userContent);
  debug.push(...research.debug);

  const outstanding = incompleteSummary(before.draft);
  const system =
    `${SYSTEM}\n\nCURRENT DRAFT (JSON):\n${JSON.stringify(before.draft)}` +
    (outstanding.length ? `\n\nSTILL MISSING (ask for these):\n${outstanding.join("\n")}` : "") +
    researchPromptBlock(research);

  debug.push(debugEvent("model.prompt", "ok", "Prepared model prompt and transcript.", {
    model: process.env.MOCK_AI === "1" ? "mock-ingest" : "configured extraction model",
    messages: messages.length,
    systemLength: system.length,
  }));

  return { before, transcript: messages, system, debug };
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
  if (process.env.MOCK_AI === "1") {
    return finalizeTurn(sessionId, before, mockDraftTurn(before.draft, userContent), userContent);
  }
  const { object } = await generateObject({
    model: getExtractionModel(),
    schema: DraftTurn,
    system,
    messages: transcript,
  });
  return finalizeTurn(sessionId, before, object, userContent);
}

export type TurnEvent =
  | { type: "debug"; event: IngestDebugEvent }
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
  const { before, transcript, system, debug } = await prepareTurn(sessionId, userContent, attachments);
  for (const event of debug) yield { type: "debug", event };

  if (process.env.MOCK_AI === "1") {
    try {
      const delayMs = Number(process.env.MOCK_AI_STREAM_DELAY_MS ?? 0);
      const object = mockDraftTurn(before.draft, userContent);
      yield { type: "debug", event: debugEvent("model.mock", "ok", "Generated deterministic MOCK_AI draft.", { properties: object.properties.length }) };
      yield { type: "partial", reply: object.reply.slice(0, 24), draft: object.properties };
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      yield { type: "partial", reply: object.reply, draft: object.properties };
      const result = await finalizeTurn(sessionId, before, object, userContent);
      yield { type: "debug", event: debugEvent("turn.persist", "ok", "Persisted mock turn result.", { readyToCommit: result.readyToCommit }) };
      yield { type: "done", result };
    } catch (e) {
      yield { type: "error", error: e instanceof Error ? e.message : "turn failed" };
    }
    return;
  }

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
    yield { type: "debug", event: debugEvent("turn.persist", "ok", "Persisted model turn result.", { readyToCommit: result.readyToCommit }) };
    yield { type: "done", result };
  } catch (e) {
    yield { type: "error", error: e instanceof Error ? e.message : "turn failed" };
  }
}

function mockDraftTurn(currentDraft: PropertyExtraction[], userContent: string): DraftTurnObject {
  const text = userContent.toLowerCase();
  if (text.includes("ecopark") && text.includes("park")) {
    return {
      reply: "Mình đã nhận diện căn hộ bán tại Ecopark / Park Premium, diện tích 58m², 2PN1VS, giá khoảng 3.6 tỷ. Bản nháp đã đủ trường bắt buộc; phần thiếu số căn cụ thể sẽ được giữ để review khi commit.",
      readyToCommit: true,
      properties: [
        {
          name: "Ecopark / Park Premium",
          projectName: "Ecopark",
          buildingName: "Park Premium",
          houseNumber: null,
          aliases: ["EcoPark", "Park Premium"],
          tags: ["apartment", "2PN1VS", "ban công Đông Nam", "tầng cao"],
          type: "apartment",
          listingType: "sale",
          priceVnd: 3_600_000_000,
          priceBasis: "total",
          areaM2: 58,
          bedrooms: 2,
          isNegotiable: false,
          dealStatus: "asking",
          locationText: "Ecopark",
          confidence: 0.78,
        },
      ],
    };
  }

  const existing = currentDraft[0];
  if (existing && /price|giá|ty|tỷ|m2|m²/i.test(userContent)) {
    return {
      reply: "Draft updated with the new details.",
      readyToCommit: true,
      properties: [{
        ...existing,
        priceVnd: existing.priceVnd ?? 4_500_000_000,
        priceBasis: existing.priceBasis === "unknown" ? "total" : existing.priceBasis,
        listingType: existing.listingType === "unknown" ? "sale" : existing.listingType,
        areaM2: existing.areaM2 ?? 75,
        bedrooms: existing.bedrooms ?? 2,
        confidence: Math.max(existing.confidence, 0.8),
      }],
    };
  }

  return {
    reply: "Still need price, area, and listing type before this can be committed.",
    readyToCommit: false,
    properties: [{
      name: userContent.slice(0, 80) || null,
      projectName: null,
      buildingName: null,
      houseNumber: null,
      aliases: [],
      tags: [],
      type: "apartment",
      listingType: text.includes("sale") || text.includes("bán") ? "sale" : "unknown",
      priceVnd: null,
      priceBasis: "unknown",
      areaM2: null,
      bedrooms: null,
      isNegotiable: false,
      dealStatus: "asking",
      locationText: userContent,
      confidence: 0.45,
    }],
  };
}

function deriveTitle(properties: PropertyExtraction[], fallback: string): string {
  const named = properties.find((p) => p.projectName || p.name)?.projectName ?? properties.find((p) => p.name)?.name;
  return (named ?? fallback).slice(0, 80);
}

async function toModelMessage(role: "user" | "assistant", content: string, attachments: Attachment[] = []): Promise<ModelMessage> {
  if (role === "assistant" || attachments.length === 0) return { role, content };
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }
  > = [{ type: "text", text: attachmentPromptText(content, attachments) }];

  for (const attachment of attachments) {
    const image = await attachmentImageData(attachment);
    if (image) parts.push({ type: "image", image, mediaType: attachment.contentType });
  }

  return {
    role: "user",
    content: parts,
  };
}

function attachmentPromptText(content: string, attachments: Attachment[]): string {
  const text = content || "Extract real-estate listing details from the attached image(s).";
  const metadata = attachments
    .map((a, i) => `Image ${i + 1}: ${a.filename}, ${a.contentType}, ${a.size} bytes, R2 key ${a.key}`)
    .join("\n");
  return `${text}\n\nAttached image metadata:\n${metadata}`;
}

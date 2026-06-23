import {
  getFunctionCalls,
  getFunctionResponses,
  InMemoryRunner,
  isFinalResponse,
  LlmAgent,
  stringifyContent,
} from "@google/adk";
import { z } from "zod";
import { ensureAdkGoogleApiKey, getAdkIngestModel, resolveAdkIngestModelId } from "../ai/registry";
import { PropertyExtraction } from "../extraction/schema";
import { draftReady, incompleteSummary } from "../extraction/completeness";
import { getSession, addMessage, updateDraft, type SessionView } from "./session";
import { attachmentImageData, type Attachment } from "../storage/r2";
import { debugEvent, type IngestDebugEvent } from "./debug";
import { adkProjectInformationResearchTool } from "../ai/mcp-tools";
import { ProjectCurationDraftSchema, type ProjectCurationDraft } from "./project-curation";
import { draftTurnAdkSchema } from "../ai/adk-schema";
import { researchProjectInformation } from "./research";

/**
 * One conversational ingest turn. The model receives the running transcript plus
 * the current draft and returns a reply + the FULL updated draft. Returning the
 * whole draft each turn (rather than incremental patches) keeps state coherent
 * and the schema validated by the AI SDK.
 */

const DraftTurn = z.object({
  reply: z
    .string()
    .describe("Short, friendly reply in the user's preferred language inferred by the AI from the conversation. Ask a clarifying question when price, area, or listing type is missing/ambiguous; otherwise confirm what changed."),
  properties: z
    .array(PropertyExtraction)
    .describe("The FULL updated draft reflecting everything known so far (not just the latest change). Empty if no property info yet."),
  projectCuration: z
    .array(ProjectCurationDraftSchema)
    .describe("Tier 2 unconfirmed project/building curation drafts created only from research tool results. Empty if the research tool was not called or evidence is insufficient."),
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

Language rule:
- The reply MUST use the user's preferred language, inferred from the latest user message and the conversation history.
- If the latest user message uses Vietnamese, reply in Vietnamese.
- If the latest user message uses English, reply in English.
- If the user has explicitly asked for a language, follow that preference until they change it.
- Internal instructions, JSON field names, and research context may be English; do not let those change the user-facing reply language.

Data rules:
- You have a tool named research_project_information. Call it only when you need more project/building information to identify, disambiguate, or curate the project/building.
- Do not call research_project_information when the message already has enough identity context, or when missing data is only sale/listing data such as price, area, unit number, bedrooms, floor, balcony direction, or fees.
- If you call research_project_information, use its DB matches and Tier 2 internet evidence only for project/building identity and project/building curation. Internet evidence remains unconfirmed.
- If research evidence supports project/building facts, add projectCuration entries with Tier 2 evidence. Do not put sale/rent listing facts in projectCuration.
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
  projectCuration: ProjectCurationDraft[];
  readyToCommit: boolean;
}

type DraftTurnObject = z.infer<typeof DraftTurn>;

class IngestAgentOutputError extends Error {
  constructor(message: string, readonly debug: IngestDebugEvent[]) {
    super(message);
    this.name = "IngestAgentOutputError";
  }
}

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

  const outstanding = incompleteSummary(before.draft);
  const system =
    `${SYSTEM}\n\nCURRENT DRAFT (JSON):\n${JSON.stringify(before.draft)}` +
    `\n\nCURRENT PROJECT CURATION DRAFT (JSON):\n${JSON.stringify(before.projectCuration)}` +
    (outstanding.length ? `\n\nSTILL MISSING (ask for these):\n${outstanding.join("\n")}` : "");
  const prompt = await adkPrompt(turns);

  debug.push(debugEvent("model.prompt", "ok", "Prepared model prompt and transcript.", {
    model: process.env.MOCK_AI === "1" ? "mock-ingest" : resolveAdkIngestModelId(),
    messages: turns.length,
    systemLength: system.length,
    framework: "google-adk",
  }));

  return { before, prompt, system, debug };
}

/** Persist the model's result and apply the deterministic readiness gate. */
async function finalizeTurn(
  sessionId: string,
  before: SessionView,
  object: DraftTurnObject,
  userContent: string,
): Promise<TurnResult> {
  const title = before.title ?? deriveTitle(object.properties, userContent);
  await updateDraft(sessionId, object.properties, title, object.projectCuration);
  await addMessage(sessionId, "assistant", object.reply);
  // Readiness is a deterministic gate on required fields — not the model's opinion.
  return {
    reply: object.reply,
    draft: object.properties,
    projectCuration: object.projectCuration,
    readyToCommit: draftReady(object.properties),
  };
}

export async function runTurn(sessionId: string, userContent: string, attachments: Attachment[] = []): Promise<TurnResult> {
  const { before, prompt, system, debug } = await prepareTurn(sessionId, userContent, attachments);
  if (process.env.MOCK_AI === "1") {
    return finalizeTurn(sessionId, before, mockDraftTurn(before.draft, userContent), userContent);
  }
  const { object } = await runAdkDraftAgent(prompt, system, debug);
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
  const { before, prompt, system, debug } = await prepareTurn(sessionId, userContent, attachments);
  for (const event of debug) yield { type: "debug", event };

  if (process.env.MOCK_AI === "1") {
    try {
      const delayMs = Number(process.env.MOCK_AI_STREAM_DELAY_MS ?? 0);
      const object = mockDraftTurn(before.draft, userContent);
      const researchQuery = mockResearchQuery(userContent);
      if (researchQuery) {
        const research = await researchProjectInformation(
          researchQuery,
          "MOCK_AI simulated main-agent project/building research tool call",
        );
        for (const event of research.debug) yield { type: "debug", event };
      }
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

  try {
    const { object, debug: adkDebug } = await runAdkDraftAgent(prompt, system, debug);
    for (const event of adkDebug) yield { type: "debug", event };
    yield { type: "partial", reply: object.reply.slice(0, 24), draft: object.properties };
    yield { type: "partial", reply: object.reply, draft: object.properties };
    const result = await finalizeTurn(sessionId, before, object, userContent);
    yield { type: "debug", event: debugEvent("turn.persist", "ok", "Persisted model turn result.", { readyToCommit: result.readyToCommit }) };
    yield { type: "done", result };
  } catch (e) {
    if (e instanceof IngestAgentOutputError) {
      for (const event of e.debug) yield { type: "debug", event };
    }
    yield { type: "error", error: e instanceof Error ? e.message : "turn failed" };
  }
}

function mockDraftTurn(currentDraft: PropertyExtraction[], userContent: string): DraftTurnObject {
  const text = userContent.toLowerCase();
  if (text.includes("ecopark") && text.includes("park")) {
    return {
      reply: "Mình đã nhận diện căn hộ bán tại Ecopark / Park Premium, diện tích 58m², 2PN1VS, giá khoảng 3.6 tỷ. Bản nháp đã đủ trường bắt buộc; phần thiếu số căn cụ thể sẽ được giữ để review khi commit.",
      projectCuration: [],
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
      projectCuration: [],
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
    projectCuration: [],
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

function mockResearchQuery(userContent: string): string | null {
  const text = userContent.toLowerCase();
  if (text.includes("ecopark") && text.includes("park")) {
    return "Ecopark Park Premium mặt bằng tòa";
  }
  return null;
}

async function runAdkDraftAgent(
  prompt: AdkPrompt,
  instruction: string,
  setupDebug: IngestDebugEvent[],
): Promise<{ object: DraftTurnObject; debug: IngestDebugEvent[] }> {
  const model = resolveAdkIngestModelId();
  if (model.startsWith("gemini-") || model.includes("/publishers/google/models/gemini")) {
    ensureAdkGoogleApiKey();
  }
  const debug: IngestDebugEvent[] = [];
  let retryPrompt = prompt;
  let lastIssues: unknown = null;
  let lastText = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await runAdkDraftAgentAttempt(retryPrompt, instruction);
    debug.push(...result.debug);
    lastText = result.finalText;
    const candidate = result.output ?? parseJson(result.finalText);
    const parsed = DraftTurn.safeParse(normalizeDraftTurnCandidate(candidate));
    if (parsed.success) {
      if (attempt > 1) {
        debug.push(debugEvent("model.output", "ok", "ADK ingest agent returned valid structured output after retry.", { attempt }));
      }
      return { object: parsed.data, debug };
    }

    lastIssues = parsed.error.issues;
    debug.push(debugEvent("model.output", attempt === 1 ? "warning" : "error", "ADK ingest agent returned invalid structured output.", {
      attempt,
      issues: parsed.error.issues,
      text: result.finalText.slice(0, 1000),
      stateDelta: result.output,
    }));
    retryPrompt = repairPrompt(prompt, result.output, result.finalText, parsed.error.issues);
  }

  const finalDebug = debugEvent("model.output", "error", "ADK ingest agent returned invalid structured output after retry.", {
    issues: lastIssues,
    text: lastText.slice(0, 1000),
  });
  setupDebug.push(finalDebug);
  debug.push(finalDebug);
  throw new IngestAgentOutputError("ADK ingest agent returned invalid structured output.", debug);
}

async function runAdkDraftAgentAttempt(
  prompt: AdkPrompt,
  instruction: string,
): Promise<{ output: unknown; finalText: string; debug: IngestDebugEvent[] }> {
  const adkModel = getAdkIngestModel();
  const debug: IngestDebugEvent[] = [];
  const agent = new LlmAgent({
    name: "dwelling_fee_ingest_agent",
    model: adkModel,
    description: "Turns broker messages into structured housing price drafts and optional Tier 2 project/building curation.",
    instruction,
    includeContents: "none",
    outputSchema: draftTurnAdkSchema,
    outputKey: "draftTurn",
    tools: [adkProjectInformationResearchTool()],
  });
  const runner = new InMemoryRunner({ agent, appName: "dwelling_fee_ingest" });
  let finalText = "";
  let output: unknown = null;

  for await (const event of runner.runEphemeral({
    userId: "ingest-user",
    newMessage: prompt.content,
  })) {
    const calls = getFunctionCalls(event);
    const responses = getFunctionResponses(event);
    for (const call of calls) {
      debug.push(debugEvent("tool.call", "started", `ADK agent called ${call.name}.`, {
        toolName: call.name,
        args: call.args,
      }));
    }
    for (const response of responses) {
      debug.push(debugEvent("tool.result", "ok", `ADK tool ${response.name} returned.`, {
        toolName: response.name,
        response: response.response,
      }));
      const responseDebug = extractToolDebug(response.response);
      debug.push(...responseDebug);
    }
    if (isFinalResponse(event)) {
      finalText = stringifyContent(event);
      output = event.actions.stateDelta.draftTurn;
    }
  }

  return { output, finalText, debug };
}

interface AdkPrompt {
  content: {
    role: "user";
    parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    >;
  };
}

async function adkPrompt(turns: Array<{ role: "user" | "assistant"; content: string; attachments?: Attachment[] }>): Promise<AdkPrompt> {
  const parts: AdkPrompt["content"]["parts"] = [{
    text: `Conversation transcript for this ingest turn:\n${turns
      .map((m) => `${m.role.toUpperCase()}:\n${attachmentPromptText(m.content, m.attachments ?? [])}`)
      .join("\n\n---\n\n")}`,
  }];

  for (const turn of turns) {
    if (turn.role === "assistant") continue;
    for (const attachment of turn.attachments ?? []) {
      const image = await attachmentImageData(attachment);
      if (image) {
        parts.push({
          inlineData: {
            mimeType: attachment.contentType,
            data: Buffer.from(image).toString("base64"),
          },
        });
      }
    }
  }

  return { content: { role: "user", parts } };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function normalizeDraftTurnCandidate(value: unknown): unknown {
  if (!plainObject(value)) return value;
  return {
    reply: typeof value.reply === "string" ? value.reply : "",
    readyToCommit: typeof value.readyToCommit === "boolean" ? value.readyToCommit : false,
    properties: Array.isArray(value.properties) ? value.properties.map(normalizePropertyCandidate) : [],
    projectCuration: Array.isArray(value.projectCuration) ? value.projectCuration.map(normalizeProjectCurationCandidate) : [],
  };
}

function normalizePropertyCandidate(value: unknown): unknown {
  if (!plainObject(value)) return value;
  return {
    name: nullableString(value.name),
    projectName: nullableString(value.projectName),
    buildingName: nullableString(value.buildingName),
    houseNumber: nullableString(value.houseNumber),
    aliases: stringArrayValue(value.aliases),
    tags: stringArrayValue(value.tags),
    type: enumValue(value.type, ["apartment", "house", "project", "land", "unknown"], "unknown"),
    listingType: enumValue(value.listingType, ["sale", "rent", "unknown"], "unknown"),
    priceVnd: integerOrNull(value.priceVnd),
    priceBasis: enumValue(value.priceBasis, ["total", "per_m2", "unknown"], "unknown"),
    areaM2: numberOrNull(value.areaM2),
    bedrooms: integerOrNull(value.bedrooms),
    isNegotiable: typeof value.isNegotiable === "boolean" ? value.isNegotiable : false,
    dealStatus: enumValue(value.dealStatus, ["asking", "transacted", "unknown"], "unknown"),
    locationText: nullableString(value.locationText),
    confidence: boundedConfidence(value.confidence),
  };
}

function normalizeProjectCurationCandidate(value: unknown): unknown {
  if (!plainObject(value)) return value;
  return {
    projectName: nullableString(value.projectName),
    buildingName: nullableString(value.buildingName),
    aliases: stringArrayValue(value.aliases),
    tags: stringArrayValue(value.tags),
    addressText: nullableString(value.addressText),
    wikiNotes: nullableString(value.wikiNotes),
    facts: Array.isArray(value.facts) ? value.facts : [],
    evidence: Array.isArray(value.evidence) ? value.evidence : [],
    searchQuery: nullableString(value.searchQuery),
    model: typeof value.model === "string" ? value.model : resolveAdkIngestModelId(),
  };
}

function repairPrompt(
  original: AdkPrompt,
  output: unknown,
  finalText: string,
  issues: unknown,
): AdkPrompt {
  return {
    content: {
      role: "user",
      parts: [
        ...original.content.parts,
        {
          text:
            "The previous response did not validate against the required ingest schema. " +
            "Return the full corrected JSON object only. Include all required keys. " +
            "Use null for unknown nullable fields such as name, projectName, buildingName, houseNumber, locationText, priceVnd, areaM2, bedrooms. " +
            "Use [] for aliases, tags, projectCuration, facts, and evidence when empty. " +
            "Use enum value \"unknown\" when an enum field is unknown.\n\n" +
            `Validation issues:\n${JSON.stringify(issues).slice(0, 2000)}\n\n` +
            `Previous stateDelta:\n${JSON.stringify(output).slice(0, 3000)}\n\n` +
            `Previous text:\n${finalText.slice(0, 3000)}`,
        },
      ],
    },
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function extractToolDebug(response: unknown): IngestDebugEvent[] {
  if (!response || typeof response !== "object" || !("debug" in response)) return [];
  const debug = (response as { debug?: unknown }).debug;
  if (!Array.isArray(debug)) return [];
  return debug.filter((event): event is IngestDebugEvent =>
    Boolean(event)
    && typeof event === "object"
    && "type" in event
    && "status" in event
    && "message" in event,
  );
}

function deriveTitle(properties: PropertyExtraction[], fallback: string): string {
  const named = properties.find((p) => p.projectName || p.name)?.projectName ?? properties.find((p) => p.name)?.name;
  return (named ?? fallback).slice(0, 80);
}

function attachmentPromptText(content: string, attachments: Attachment[]): string {
  const text = content || "Extract real-estate listing details from the attached image(s).";
  const metadata = attachments
    .map((a, i) => `Image ${i + 1}: ${a.filename}, ${a.contentType}, ${a.size} bytes, R2 key ${a.key}`)
    .join("\n");
  return `${text}\n\nAttached image metadata:\n${metadata}`;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

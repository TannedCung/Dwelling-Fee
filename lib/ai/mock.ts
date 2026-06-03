import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import type { PropertyExtraction } from "../extraction/schema";
import { missingFields } from "../extraction/completeness";

/**
 * Deterministic, offline language model used for tests (gated by MOCK_AI=1 in the
 * registry). It does NOT call any provider: it parses Vietnamese/English shorthand
 * out of the latest user turn with simple regexes, merges it onto the current draft
 * (read from the system prompt), and returns a DraftTurn-shaped JSON object — the
 * same shape generateObject/streamObject expect. This lets e2e exercise the real
 * streaming route, persistence, and completeness gating without network or cost.
 */

interface DraftTurnShape {
  reply: string;
  properties: PropertyExtraction[];
  readyToCommit: boolean;
}

function emptyProperty(): PropertyExtraction {
  return {
    name: null,
    projectName: null,
    buildingName: null,
    houseNumber: null,
    aliases: [],
    tags: [],
    type: "unknown",
    listingType: "unknown",
    priceVnd: null,
    priceBasis: "unknown",
    areaM2: null,
    bedrooms: null,
    isNegotiable: false,
    dealStatus: "asking",
    locationText: null,
    confidence: 0.6,
  };
}

// `\b` is ASCII-only, so it fails right after Vietnamese diacritics ("tỷ") or the
// "²" sign. Use a Unicode-aware "not followed by a letter" guard instead.
const END = "(?![\\p{L}])";

function detectPrice(text: string): { priceVnd: number | null; priceBasis: "total" | "per_m2" | null } {
  const perM2 = /\/\s*m2|\/\s*m²|per\s*m2/iu.test(text);
  // "4.5 tỷ", "4 ti", "850 triệu", "30 tr"
  const ty = text.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:tỷ|tỉ|ty|ti)${END}`, "iu"));
  const trieu = text.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:triệu|trieu|tr)${END}`, "iu"));
  const raw = text.match(/(?:price|giá)\s*[:=]?\s*(\d{6,})/iu);
  let priceVnd: number | null = null;
  if (ty) priceVnd = Math.round(parseFloat(ty[1]!.replace(",", ".")) * 1e9);
  else if (trieu) priceVnd = Math.round(parseFloat(trieu[1]!.replace(",", ".")) * 1e6);
  else if (raw) priceVnd = parseInt(raw[1]!, 10);
  return { priceVnd, priceBasis: priceVnd == null ? null : perM2 ? "per_m2" : "total" };
}

function detectListingType(text: string): "sale" | "rent" | null {
  if (/thuê|\brent\b|cho thuê/iu.test(text)) return "rent";
  if (/bán|\bsale\b|cần bán|for sale/iu.test(text)) return "sale";
  return null;
}

function detectArea(text: string): number | null {
  const m = text.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:m2|m²|met|mét)${END}`, "iu"));
  return m ? parseFloat(m[1]!.replace(",", ".")) : null;
}

function detectBedrooms(text: string): number | null {
  const m = text.match(new RegExp(`(\\d+)\\s*(?:pn|br|bedroom|phòng ngủ)${END}`, "iu"));
  return m ? parseInt(m[1]!, 10) : null;
}

function detectLocation(text: string): string | null {
  const m =
    text.match(/\b(?:quận|district|q\.?)\s*(\d{1,2})\b/i) ||
    text.match(/\b(?:phường|ward|p\.?)\s*(\d{1,2})\b/i);
  if (m) return m[0].trim();
  const named = text.match(/\b(?:in|ở|tại)\s+([A-ZÀ-Ỹ][\wÀ-ỹ]+(?:\s+[A-ZÀ-Ỹ][\wÀ-ỹ]+){0,2})/);
  return named ? named[1]!.trim() : null;
}

function detectName(text: string): string | null {
  const m = text.match(
    /\b(?:dự án|project|căn hộ|chung cư|toà|tòa|building)\s+([A-ZÀ-Ỹ][\wÀ-ỹ]+(?:\s+[A-ZÀ-Ỹ][\wÀ-ỹ]+){0,2})/i,
  );
  if (m) return m[1]!.trim();
  const explicit = text.match(/\bname\s*[:=]\s*([^\n,]+)/i);
  return explicit ? explicit[1]!.trim() : null;
}

function lastUserText(prompt: LanguageModelV3Prompt): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const msg = prompt[i]!;
    if (msg.role === "user") {
      return msg.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join(" ")
        .trim();
    }
  }
  return "";
}

function currentDraft(prompt: LanguageModelV3Prompt): PropertyExtraction[] {
  const system = prompt.find((m) => m.role === "system");
  if (!system || typeof system.content !== "string") return [];
  const m = system.content.match(/CURRENT DRAFT \(JSON\):\n(.+?)(?:\n\n|$)/s);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[1]!);
    return Array.isArray(parsed) ? (parsed as PropertyExtraction[]) : [];
  } catch {
    return [];
  }
}

/** The core deterministic policy: merge detected fields onto the draft and reply. */
export function buildMockTurn(prompt: LanguageModelV3Prompt): DraftTurnShape {
  const text = lastUserText(prompt);
  const draft = currentDraft(prompt);

  // Skip/clear intent.
  if (/\b(skip|remove|delete|bỏ qua|xoá)\b/i.test(text) && draft.length > 0) {
    const rest = draft.slice(0, -1);
    return {
      reply: "Okay, I've dropped that property from the draft.",
      properties: rest,
      readyToCommit: rest.length > 0 && rest.every((p) => missingFields(p).length === 0),
    };
  }

  const prop: PropertyExtraction = draft.length ? { ...draft[draft.length - 1]! } : emptyProperty();

  const { priceVnd, priceBasis } = detectPrice(text);
  if (priceVnd != null) {
    prop.priceVnd = priceVnd;
    if (priceBasis) prop.priceBasis = priceBasis;
  }
  const listingType = detectListingType(text);
  if (listingType) prop.listingType = listingType;
  const area = detectArea(text);
  if (area != null) prop.areaM2 = area;
  const bedrooms = detectBedrooms(text);
  if (bedrooms != null) prop.bedrooms = bedrooms;
  const name = detectName(text);
  if (name) prop.name = name;
  const location = detectLocation(text);
  if (location) prop.locationText = location;
  if (prop.type === "unknown") {
    if (/căn hộ|chung cư|apartment|\bch\b/i.test(text)) prop.type = "apartment";
    else if (/nhà|house|villa/i.test(text)) prop.type = "house";
    else if (/đất|land/i.test(text)) prop.type = "land";
  }
  if (/\btl\b|thương lượng|thỏa thuận|negotiable/i.test(text)) prop.isNegotiable = true;

  const properties = [...draft.slice(0, -1), prop];
  // If there was no draft yet but we detected nothing useful, keep draft empty.
  const useful =
    priceVnd != null || listingType || area != null || name || location || draft.length > 0;
  const finalProps = useful ? properties : [];

  const missing = finalProps.flatMap((p) => missingFields(p));
  const ready = finalProps.length > 0 && missing.length === 0;
  const reply = ready
    ? "Got everything I need — the draft looks complete. You can commit it now."
    : finalProps.length === 0
      ? "I couldn't find any property details there. Paste a listing with a price, area and location."
      : `Thanks. Still need: ${[...new Set(missing)].join(", ")}. Can you provide those?`;

  return { reply, properties: finalProps, readyToCommit: ready };
}

const usage: LanguageModelV3Usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function jsonFor(options: LanguageModelV3CallOptions): string {
  return JSON.stringify(buildMockTurn(options.prompt));
}

/** A LanguageModelV3 whose output is fully determined by the prompt — no network. */
export function createMockModel(): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock-extractor",
    supportedUrls: {},
    async doGenerate(options) {
      const json = jsonFor(options);
      return {
        content: [{ type: "text", text: json }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
    async doStream(options) {
      const json = jsonFor(options);
      // Chunk so streamObject emits progressive partials (reply fills in first).
      const chunks: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "0" },
      ];
      const size = Math.max(8, Math.ceil(json.length / 20));
      for (let i = 0; i < json.length; i += size) {
        chunks.push({ type: "text-delta", id: "0", delta: json.slice(i, i + size) });
      }
      chunks.push({ type: "text-end", id: "0" });
      chunks.push({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });

      // Optional inter-chunk delay so tests can observe progressive streaming.
      const delayMs = Number(process.env.MOCK_AI_STREAM_DELAY_MS ?? 0);
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller) {
          for (const c of chunks) {
            controller.enqueue(c);
            if (delayMs > 0 && c.type === "text-delta") {
              await new Promise((r) => setTimeout(r, delayMs));
            }
          }
          controller.close();
        },
      });
      return { stream };
    },
  };
}

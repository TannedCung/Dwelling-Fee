import Anthropic from "@anthropic-ai/sdk";
import { ExtractionResult, EXTRACTION_TOOL_SCHEMA } from "./schema";

// Cheap, high-volume model for extraction per docs/design.md §8 (model tiering).
const MODEL = "claude-haiku-4-5-20251001";

// Prompt version is recorded alongside every observation for reproducibility
// (price_observation.extractor in the schema).
export const EXTRACTOR_VERSION = `${MODEL}/extract-v1`;

const SYSTEM_PROMPT = `You extract structured real-estate facts from messy broker messages and web posts.

The text is Vietnamese real-estate shorthand, sometimes mixed with English. Decode common abbreviations:
- Price units: "tỷ"/"tỉ" = 1,000,000,000 VND; "triệu"/"tr" = 1,000,000 VND. "4.5 tỷ" -> 4500000000.
- "TL", "thương lượng", "thỏa thuận" -> price is negotiable (isNegotiable=true).
- "PN" / "phòng ngủ" = bedrooms ("2PN" -> bedrooms=2).
- "m2", "m²" -> areaM2.
- "sổ hồng"/"SHR"/"sổ đỏ" = has land title (a legal note; does not change price fields).
- "/m2", "/m²", "1m2" alongside a price means priceBasis="per_m2", otherwise "total".
- "cho thuê" = rent (listingType="rent"); "bán" / "cần bán" = sale.
- "đã bán"/"sold"/"chốt" = transacted; an active listing = asking.

Rules:
- A single message may describe MULTIPLE properties. Return one object per distinct property.
- Normalize priceVnd to an INTEGER number of VND. If only a per-m² price is given, set priceBasis="per_m2" and put that per-m² figure in priceVnd.
- Use null for any field genuinely absent. Do NOT guess prices or areas that aren't stated.
- confidence reflects how certain YOU are about that property's fields (lower it for ambiguous/partial messages).
- Never invent properties; if the text has no property info, return an empty array.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Export it before running the harness.");
  }
  client ??= new Anthropic();
  return client;
}

export async function extract(rawText: string): Promise<ExtractionResult> {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [
      // Cache the static system prompt across calls (docs/design.md §8 cost control).
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    tools: [
      {
        name: "record_properties",
        description: "Record the structured property facts extracted from the message.",
        input_schema: EXTRACTION_TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "record_properties" },
    messages: [{ role: "user", content: rawText }],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return the expected tool call.");
  }
  // Validate against zod so a malformed model response fails loudly here, not downstream.
  return ExtractionResult.parse(toolUse.input);
}

// `tsx phase0/extract.ts "<message>"` — quick manual one-off.
if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv[2];
  if (!text) {
    console.error('Usage: npm run phase0:extract -- "<broker message>"');
    process.exit(1);
  }
  extract(text)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}

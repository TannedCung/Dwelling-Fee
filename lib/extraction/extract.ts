import { generateObject } from "ai";
import { getExtractionModel, EXTRACTOR_VERSION } from "../ai/registry";
import { ExtractionResult } from "./schema";

// Re-exported so callers keep importing the extractor surface from one place.
export { EXTRACTOR_VERSION };

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

/**
 * Extract structured property facts from one raw signal. Provider/model is chosen
 * by env via lib/ai/registry (Anthropic, OpenAI, or Gemini). The AI SDK validates
 * the response against the zod schema, so a malformed model reply throws here.
 */
export async function extract(rawText: string): Promise<ExtractionResult> {
  const { object } = await generateObject({
    model: getExtractionModel(),
    schema: ExtractionResult,
    system: SYSTEM_PROMPT,
    prompt: rawText,
  });
  return object;
}

// `tsx lib/extraction/extract.ts "<message>"` — quick manual one-off.
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

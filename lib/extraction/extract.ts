import { generateObject } from "ai";
import { getExtractionModel, EXTRACTOR_VERSION } from "../ai/registry";
import { ExtractionResult } from "./schema";
import { attachmentImageData, type Attachment } from "../storage/r2";

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
- If images are attached, read visible listing text/screenshots from those images and merge them with the typed text.

Rules:
- A single message may describe MULTIPLE observations/listings. Return one object per distinct observed listing, not one object for every label/token.
- Separate property identity into hierarchy:
  projectName = root project/development/place name, without category prefixes.
  buildingName = block/tower/building/phase, e.g. "Block A", "Tòa S1".
  houseNumber = unit/apartment/lot/house number, e.g. "Căn 1", "A1204", "LK-12".
  name = a readable display name for the hierarchy, e.g. "ABC / Block A / Căn 1".
- For web listings, use the title and source URL as evidence for hierarchy. If a title or slug says
  "<sub-development/tower/residence> <root project>" (for example a named residence inside a larger
  project), keep the root as projectName and put the sub-development/tower/residence in buildingName.
- Do NOT treat generic unit labels like "Căn 1", "căn số 2", "Unit A1204", or "lô 5" as standalone properties unless there is a project/address context. Put them in houseNumber.
- For apartments, project/building alone is context, not the specific property. If the unit is missing, keep projectName/buildingName, lower confidence, and do not invent houseNumber.
- Names like "nhà phố ABC", "shophouse ABC", "căn hộ ABC", and "ABC" are the SAME project/property identity. Set projectName="ABC" and put "nhà phố"/"shophouse"/"căn hộ" in tags.
- Use aliases for observed spelling/name variants and tags for reusable category/context labels; keep tags consistent so properties and observations can share them.
- Normalize priceVnd to an INTEGER number of VND. If only a per-m² price is given, set priceBasis="per_m2" and put that per-m² figure in priceVnd.
- Use null for any field genuinely absent. Do NOT guess prices or areas that aren't stated.
- confidence reflects how certain YOU are about that property's fields (lower it for ambiguous/partial messages).
- Never invent properties; if the text has no property info, return an empty array.`;

/**
 * Extract structured property facts from one raw signal. Provider/model is chosen
 * by env via lib/ai/registry (Anthropic, OpenAI, or Gemini). The AI SDK validates
 * the response against the zod schema, so a malformed model reply throws here.
 */
export async function extract(rawText: string, attachments: Attachment[] = []): Promise<ExtractionResult> {
  const content = await extractionMessageContent(rawText, attachments);
  const { object } = await generateObject({
    model: getExtractionModel(),
    schema: ExtractionResult,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content,
    }],
  });
  return object;
}

async function extractionMessageContent(rawText: string, attachments: Attachment[]) {
  if (attachments.length === 0) return rawText;
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }
  > = [{ type: "text", text: attachmentPromptText(rawText, attachments) }];
  for (const attachment of attachments) {
    const image = await attachmentImageData(attachment);
    if (image) parts.push({ type: "image", image, mediaType: attachment.contentType });
  }
  return parts;
}

function attachmentPromptText(rawText: string, attachments: Attachment[]): string {
  const text = rawText || "Extract real-estate listing details from the attached image(s).";
  const metadata = attachments
    .map((a, i) => `Image ${i + 1}: ${a.filename}, ${a.contentType}, ${a.size} bytes, R2 key ${a.key}`)
    .join("\n");
  return `${text}\n\nAttached image metadata:\n${metadata}`;
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

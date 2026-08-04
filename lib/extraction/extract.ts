import { generateObject } from "ai";
import { getExtractionModel, EXTRACTOR_VERSION } from "../ai/registry";
import { ExtractionResult } from "./schema";
import { attachmentImageData, type Attachment } from "../storage/r2";
import { buildSkillPromptInstructions } from "../skills";

// Re-exported so callers keep importing the extractor surface from one place.
export { EXTRACTOR_VERSION };

export async function buildExtractionSystemPrompt(text: string): Promise<string> {
  const skillInstructions = await buildSkillPromptInstructions({ text, taskType: "extraction" });
  return `You extract structured real-estate facts from messy broker messages and web posts.

${skillInstructions}

Additional Rules for Extraction:
- A single message may describe MULTIPLE observations/listings. Return one object per distinct observed listing, not one object for every label/token.
- For web listings, use the title and source URL as evidence for hierarchy. If a title or slug says
  "<sub-development/tower/residence> <root project>" (for example a named residence inside a larger
  project), keep the root as projectName and put the sub-development/tower/residence in buildingName.
- Use aliases for observed spelling/name variants and tags for reusable category/context labels; keep tags consistent so properties and observations can share them.
- Normalize priceVnd to an INTEGER number of VND. If only a per-m² price is given, set priceBasis="per_m2" and put that per-m² figure in priceVnd.
- Use null for any field genuinely absent. Do NOT guess prices or areas that aren't stated.
- confidence reflects how certain YOU are about that property's fields (lower it for ambiguous/partial messages, set <= 0.4 for very noisy text).
- Never invent properties; if the text has no actionable property listing info, return an empty array.`;
}

/**
 * Extract structured property facts from one raw signal. Provider/model is chosen
 * by env via lib/ai/registry (Anthropic, OpenAI, or Gemini). The AI SDK validates
 * the response against the zod schema, so a malformed model reply throws here.
 */
export async function extract(rawText: string, attachments: Attachment[] = []): Promise<ExtractionResult> {
  if (process.env.MOCK_AI === "1") {
    return mockExtract(rawText);
  }
  const content = await extractionMessageContent(rawText, attachments);
  const system = await buildExtractionSystemPrompt(rawText);
  const { object } = await generateObject({
    model: getExtractionModel(),
    schema: ExtractionResult,
    system,
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

function mockExtract(text: string): ExtractionResult {
  const lower = text.toLowerCase();

  // Rejection & Noise cases -> []
  if (
    lower.includes("cần mua") ||
    lower.includes("tìm mua") ||
    lower.includes("tìm thuê") ||
    lower.includes("tuyển dụng") ||
    lower.includes("chúc mọi người") ||
    (lower.includes("siêu phẩm") && !lower.includes("tỷ") && !lower.includes("tr"))
  ) {
    return { properties: [] };
  }

  if (lower.includes("vinhomes grand park") && lower.includes("3.2 tỷ")) {
    return {
      properties: [{
        name: "Vinhomes Grand Park / Q9",
        projectName: "Vinhomes Grand Park",
        buildingName: null,
        houseNumber: null,
        aliases: ["Vinhomes Grand Park"],
        tags: ["sổ hồng"],
        type: "apartment",
        listingType: "sale",
        priceVnd: 3_200_000_000,
        priceBasis: "total",
        areaM2: 60,
        bedrooms: 2,
        isNegotiable: false,
        dealStatus: "asking",
        locationText: "Q9",
        confidence: 0.9,
      }],
    };
  }

  if (lower.includes("masteri thảo điền") && lower.includes("18 triệu")) {
    return {
      properties: [{
        name: "Masteri Thảo Điền",
        projectName: "Masteri Thảo Điền",
        buildingName: null,
        houseNumber: null,
        aliases: [],
        tags: [],
        type: "apartment",
        listingType: "rent",
        priceVnd: 18_000_000,
        priceBasis: "total",
        areaM2: 70,
        bedrooms: 2,
        isNegotiable: true,
        dealStatus: "asking",
        locationText: "Masteri Thảo Điền",
        confidence: 0.88,
      }],
    };
  }

  if (lower.includes("nguyễn văn linh") && lower.includes("80 triệu")) {
    return {
      properties: [{
        name: "Nguyễn Văn Linh",
        projectName: null,
        buildingName: null,
        houseNumber: null,
        aliases: [],
        tags: ["đất"],
        type: "land",
        listingType: "sale",
        priceVnd: 80_000_000,
        priceBasis: "per_m2",
        areaM2: 100,
        bedrooms: null,
        isNegotiable: true,
        dealStatus: "asking",
        locationText: "Nguyễn Văn Linh",
        confidence: 0.85,
      }],
    };
  }

  if (lower.includes("giỏ hàng hôm nay")) {
    return {
      properties: [
        {
          name: "Sunrise City Q7",
          projectName: "Sunrise City",
          buildingName: null,
          houseNumber: null,
          aliases: [],
          tags: [],
          type: "apartment",
          listingType: "sale",
          priceVnd: 5_500_000_000,
          priceBasis: "total",
          areaM2: 100,
          bedrooms: 3,
          isNegotiable: false,
          dealStatus: "asking",
          locationText: "Q7",
          confidence: 0.9,
        },
        {
          name: "Phú Mỹ Hưng",
          projectName: "Phú Mỹ Hưng",
          buildingName: null,
          houseNumber: null,
          aliases: [],
          tags: ["nhà phố"],
          type: "house",
          listingType: "sale",
          priceVnd: 15_000_000_000,
          priceBasis: "total",
          areaM2: null,
          bedrooms: null,
          isNegotiable: true,
          dealStatus: "asking",
          locationText: "Phú Mỹ Hưng",
          confidence: 0.85,
        },
      ],
    };
  }

  if (lower.includes("sun avenue") && lower.includes("4.1 tỷ")) {
    return {
      properties: [{
        name: "The Sun Avenue",
        projectName: "The Sun Avenue",
        buildingName: null,
        houseNumber: null,
        aliases: [],
        tags: [],
        type: "apartment",
        listingType: "sale",
        priceVnd: 4_100_000_000,
        priceBasis: "total",
        areaM2: 72,
        bedrooms: 2,
        isNegotiable: false,
        dealStatus: "transacted",
        locationText: "Sun Avenue",
        confidence: 0.92,
      }],
    };
  }

  if (lower.includes("estella heights")) {
    return {
      properties: [{
        name: "Estella Heights",
        projectName: "Estella Heights",
        buildingName: null,
        houseNumber: null,
        aliases: [],
        tags: [],
        type: "apartment",
        listingType: "sale",
        priceVnd: 8_200_000_000,
        priceBasis: "total",
        areaM2: 115,
        bedrooms: 3,
        isNegotiable: true,
        dealStatus: "asking",
        locationText: "Estella",
        confidence: 0.9,
      }],
    };
  }

  if (lower.includes("vinhomes central park") && lower.includes("inbox giá")) {
    return {
      properties: [{
        name: "Vinhomes Central Park",
        projectName: "Vinhomes Central Park",
        buildingName: null,
        houseNumber: null,
        aliases: [],
        tags: ["view sông"],
        type: "apartment",
        listingType: "sale",
        priceVnd: null,
        priceBasis: "unknown",
        areaM2: 50,
        bedrooms: 1,
        isNegotiable: false,
        dealStatus: "asking",
        locationText: "Central Park",
        confidence: 0.7,
      }],
    };
  }

  if (lower.includes("bình thạnh") && lower.includes("6ty5")) {
    return {
      properties: [{
        name: "Bình Thạnh",
        projectName: null,
        buildingName: null,
        houseNumber: null,
        aliases: [],
        tags: ["nhà hẻm", "shr"],
        type: "house",
        listingType: "sale",
        priceVnd: 6_500_000_000,
        priceBasis: "total",
        areaM2: 60,
        bedrooms: null,
        isNegotiable: false,
        dealStatus: "asking",
        locationText: "Bình Thạnh",
        confidence: 0.85,
      }],
    };
  }

  if (lower.includes("gò vấp") && lower.includes("4tr5")) {
    return {
      properties: [{
        name: "Gò Vấp",
        projectName: null,
        buildingName: null,
        houseNumber: null,
        aliases: [],
        tags: ["phòng trọ", "có gác"],
        type: "apartment",
        listingType: "rent",
        priceVnd: 4_500_000,
        priceBasis: "total",
        areaM2: 25,
        bedrooms: null,
        isNegotiable: false,
        dealStatus: "asking",
        locationText: "Gò Vấp",
        confidence: 0.88,
      }],
    };
  }

  if (lower.includes("ecopark") && lower.includes("3.6x tỷ")) {
    return {
      properties: [{
        name: "Ecopark Park Premium",
        projectName: "Ecopark",
        buildingName: "Park Premium",
        houseNumber: null,
        aliases: ["Ecopark"],
        tags: ["2PN"],
        type: "apartment",
        listingType: "sale",
        priceVnd: 3_600_000_000,
        priceBasis: "total",
        areaM2: 58,
        bedrooms: 2,
        isNegotiable: false,
        dealStatus: "asking",
        locationText: "Ecopark",
        confidence: 0.75,
      }],
    };
  }

  if (lower.includes("shophouse") && lower.includes("18.5 tỷ")) {
    return {
      properties: [{
        name: "Masteri Thảo Điền",
        projectName: "Masteri Thảo Điền",
        buildingName: null,
        houseNumber: null,
        aliases: [],
        tags: ["shophouse"],
        type: "apartment",
        listingType: "sale",
        priceVnd: 18_500_000_000,
        priceBasis: "total",
        areaM2: 120,
        bedrooms: null,
        isNegotiable: false,
        dealStatus: "asking",
        locationText: "Masteri",
        confidence: 0.9,
      }],
    };
  }

  // Heuristic extraction fallback for live scraped web listings in MOCK_AI mode
  const priceMatch = lower.match(/(\d+(?:\.\d+)?)\s*(tỷ|tỉ|triệu|tr)/i);
  const areaMatch = lower.match(/(\d+(?:\.\d+)?)\s*(m2|m²|sqm)/i);
  const bedMatch = lower.match(/(\d+)\s*(pn|phòng ngủ|n\b)/i);

  const isSale = lower.includes("bán") || lower.includes("cần bán") || lower.includes("bán gấp");
  const isRent = lower.includes("cho thuê") || lower.includes("cho thue");
  const listingType = isRent ? "rent" : isSale ? "sale" : "unknown";

  if (priceMatch || areaMatch) {
    let priceVnd: number | null = null;
    let priceBasis: "total" | "per_m2" | "unknown" = "total";

    if (priceMatch) {
      const val = parseFloat(priceMatch[1]!);
      const unit = priceMatch[2]!.toLowerCase();
      if (unit.startsWith("t")) {
        priceVnd = Math.round(val * 1_000_000_000);
      } else {
        priceVnd = Math.round(val * 1_000_000);
      }
    }

    if (lower.includes("/m2") || lower.includes("/m²")) {
      priceBasis = "per_m2";
    }

    const areaM2 = areaMatch ? parseFloat(areaMatch[1]!) : null;
    const bedrooms = bedMatch ? parseInt(bedMatch[1]!, 10) : null;

    let projectName: string | null = null;
    if (lower.includes("ecopark")) projectName = "Ecopark";
    else if (lower.includes("vinhomes")) projectName = "Vinhomes";
    else if (lower.includes("masteri")) projectName = "Masteri";

    return {
      properties: [{
        name: text.slice(0, 60),
        projectName,
        buildingName: null,
        houseNumber: null,
        aliases: [],
        tags: [],
        type: lower.includes("biệt thự") || lower.includes("nhà phố") ? "house" : lower.includes("đất") ? "land" : "apartment",
        listingType,
        priceVnd,
        priceBasis,
        areaM2,
        bedrooms,
        isNegotiable: lower.includes("thương lượng") || lower.includes("tl"),
        dealStatus: "asking",
        locationText: projectName ?? "Hưng Yên",
        confidence: 0.82,
      }],
    };
  }

  return { properties: [] };
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


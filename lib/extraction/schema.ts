import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * Structured extraction target for a single property mentioned in a raw signal.
 * One broker message may describe several properties → an array of these.
 *
 * Field semantics mirror `price_observation` in docs/design.md so the harness
 * proves out the exact shape the DB will store.
 */
export const PropertyExtraction = z.object({
  // Free-text identity as written by the broker (project/building/unit), kept verbatim-ish.
  name: z.string().nullable(),
  type: z.enum(["apartment", "house", "project", "land", "unknown"]),
  listingType: z.enum(["sale", "rent", "unknown"]),
  // Normalized to integer VND. "4.5 tỷ" -> 4_500_000_000, "850 triệu" -> 850_000_000.
  priceVnd: z.number().int().nullable(),
  // Whether the quoted price is a total or a per-m² figure.
  priceBasis: z.enum(["total", "per_m2", "unknown"]),
  areaM2: z.number().nullable(),
  bedrooms: z.number().int().nullable(),
  isNegotiable: z.boolean(),
  // asking = listed/offered, transacted/sold = a closed deal, unknown otherwise.
  dealStatus: z.enum(["asking", "transacted", "unknown"]),
  // Location as written (district/ward/street/project). Geocoding is a later step.
  locationText: z.string().nullable(),
  // Extractor's self-rated confidence 0..1 for this property's fields.
  confidence: z.number().min(0).max(1),
});

export type PropertyExtraction = z.infer<typeof PropertyExtraction>;

export const ExtractionResult = z.object({
  properties: z.array(PropertyExtraction),
});

export type ExtractionResult = z.infer<typeof ExtractionResult>;

/**
 * JSON Schema handed to Claude as a forced tool, so the model returns structured
 * output instead of prose. Kept in sync with the zod schema above by hand (small
 * surface; not worth a generator yet).
 */
export const EXTRACTION_TOOL_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    properties: {
      type: "array",
      description: "One entry per distinct property mentioned in the message.",
      items: {
        type: "object",
        properties: {
          name: { type: ["string", "null"], description: "Project/building/unit name as written." },
          type: { type: "string", enum: ["apartment", "house", "project", "land", "unknown"] },
          listingType: { type: "string", enum: ["sale", "rent", "unknown"] },
          priceVnd: {
            type: ["integer", "null"],
            description: "Total or per-m² price normalized to integer VND. tỷ=1e9, triệu=1e6.",
          },
          priceBasis: { type: "string", enum: ["total", "per_m2", "unknown"] },
          areaM2: { type: ["number", "null"] },
          bedrooms: { type: ["integer", "null"] },
          isNegotiable: { type: "boolean", description: "True if price is negotiable (TL, thương lượng)." },
          dealStatus: { type: "string", enum: ["asking", "transacted", "unknown"] },
          locationText: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: [
          "name", "type", "listingType", "priceVnd", "priceBasis", "areaM2",
          "bedrooms", "isNegotiable", "dealStatus", "locationText", "confidence",
        ],
      },
    },
  },
  required: ["properties"],
};

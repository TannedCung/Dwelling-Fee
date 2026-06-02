import { z } from "zod";

/**
 * Structured extraction target for a single property mentioned in a raw signal.
 * One broker message may describe several properties → an array of these.
 *
 * Field semantics mirror `price_observation` in docs/design.md so the harness
 * proves out the exact shape the DB will store.
 */
export const PropertyExtraction = z.object({
  name: z.string().nullable().describe("Project/building/unit name as written by the broker."),
  type: z.enum(["apartment", "house", "project", "land", "unknown"]),
  listingType: z.enum(["sale", "rent", "unknown"]),
  priceVnd: z
    .number()
    .int()
    .nullable()
    .describe("Total or per-m² price normalized to integer VND. tỷ=1e9, triệu=1e6. null if absent."),
  priceBasis: z
    .enum(["total", "per_m2", "unknown"])
    .describe('"per_m2" if the price is quoted per m², otherwise "total".'),
  areaM2: z.number().nullable(),
  bedrooms: z.number().int().nullable(),
  isNegotiable: z.boolean().describe("True if price is negotiable (TL, thương lượng, thỏa thuận)."),
  dealStatus: z
    .enum(["asking", "transacted", "unknown"])
    .describe("asking = active listing/offer; transacted = closed deal (đã bán/chốt/sold)."),
  locationText: z.string().nullable().describe("Location as written (district/ward/street/project)."),
  confidence: z.number().min(0).max(1).describe("Self-rated 0..1 certainty for this property's fields."),
});

export type PropertyExtraction = z.infer<typeof PropertyExtraction>;

export const ExtractionResult = z.object({
  properties: z.array(PropertyExtraction).describe("One entry per distinct property; empty if none."),
});

export type ExtractionResult = z.infer<typeof ExtractionResult>;

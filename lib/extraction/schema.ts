import { z } from "zod";

/**
 * Structured extraction target for a single property mentioned in a raw signal.
 * One broker message may describe several properties → an array of these.
 *
 * Field semantics mirror `price_observation` in docs/design.md so the harness
 * proves out the exact shape the DB will store.
 */
export const PropertyExtraction = z.object({
  name: z
    .string()
    .nullable()
    .default(null)
    .describe("Human-readable display name for the full hierarchy; do not use only generic labels like 'Căn 1'."),
  projectName: z
    .string()
    .nullable()
    .default(null)
    .describe("Root project/development/neighborhood name, e.g. 'ABC'. Strip category prefixes like 'nhà phố'."),
  buildingName: z
    .string()
    .nullable()
    .default(null)
    .describe("Building/tower/block/phase within the project, e.g. 'Block A' or 'Tòa S1'."),
  houseNumber: z
    .string()
    .nullable()
    .default(null)
    .describe("Unit/apartment/lot/house number, e.g. 'Căn 1', 'A1204', 'LK-12'."),
  aliases: z
    .array(z.string())
    .default([])
    .describe("Observed spelling/name variants for the same property identity."),
  tags: z
    .array(z.string())
    .default([])
    .describe("Reusable category/context tags such as 'nhà phố', 'shophouse', 'penthouse', or legal/layout notes."),
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

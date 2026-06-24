import { generateObject } from "ai";
import { z } from "zod";
import { getExtractionModel } from "../ai/registry";

const MAX_AGENT_INPUT_CHARS = 12_000;

export const EdgePostDistillation = z.object({
  title: z.string().nullable(),
  listingType: z.enum(["sale", "rent", "unknown"]),
  propertyType: z.enum(["apartment", "house", "project", "land", "unknown"]),
  projectName: z.string().nullable(),
  buildingName: z.string().nullable(),
  houseNumber: z.string().nullable(),
  locationText: z.string().nullable(),
  priceText: z.string().nullable(),
  areaText: z.string().nullable(),
  bedroomsText: z.string().nullable(),
  legalText: z.string().nullable(),
  layoutText: z.string().nullable(),
  statusText: z.string().nullable(),
  usefulFacts: z.array(z.string()).max(12),
  confidence: z.number().min(0).max(1),
});

export type EdgePostDistillation = z.infer<typeof EdgePostDistillation>;

const SYSTEM_PROMPT = `You are a compact preprocessing agent for Vietnamese real-estate web listing posts.

Your job is to distill one scraped public listing card into concise extraction-ready facts.

Rules:
- Preserve only facts explicitly present in the post. Do not infer or invent.
- Remove navigation text, filter labels, ads, cookie notices, repeated site chrome, save/share labels, and contact prompts.
- Remove phone numbers, contact names, and seller/broker identity details if present.
- Keep price text exactly enough for downstream normalization, including "tỷ", "triệu", "/m²", "thỏa thuận", "TL".
- Keep area, bedrooms, bathrooms, direction, floor, legal/title, handover/furniture, project, building/tower, unit/house number, and location when stated.
- If several facts conflict, keep the text as written and lower confidence.
- Return null for absent fields and an empty usefulFacts array if nothing useful remains.`;

export async function distillEdgePost(input: {
  rawText: string;
  sourceRef: string;
  pageUrl?: string | null;
}): Promise<string> {
  if (process.env.MOCK_AI === "1") return deterministicDistillation(input);

  const rawText = trimForAgent(input.rawText);
  const { object } = await generateObject({
    model: getExtractionModel(),
    schema: EdgePostDistillation,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        `Source listing URL: ${input.sourceRef}`,
        input.pageUrl ? `Search/list page URL: ${input.pageUrl}` : null,
        "",
        "Raw scraped listing card text:",
        rawText,
      ].filter((line): line is string => line !== null).join("\n"),
    }],
  });

  return formatDistilledEdgePost(object, input);
}

export function formatDistilledEdgePost(
  post: EdgePostDistillation,
  source: { sourceRef: string; pageUrl?: string | null },
): string {
  const lines = [
    "Distilled public web listing for extraction.",
    `Source URL: ${source.sourceRef}`,
    source.pageUrl ? `Collected from: ${source.pageUrl}` : null,
    field("Title", post.title),
    field("Listing type", post.listingType !== "unknown" ? post.listingType : null),
    field("Property type", post.propertyType !== "unknown" ? post.propertyType : null),
    field("Project", post.projectName),
    field("Building", post.buildingName),
    field("Unit/house number", post.houseNumber),
    field("Location", post.locationText),
    field("Price", post.priceText),
    field("Area", post.areaText),
    field("Bedrooms/bathrooms", post.bedroomsText),
    field("Legal", post.legalText),
    field("Layout/furniture", post.layoutText),
    field("Status", post.statusText),
  ].filter((line): line is string => Boolean(line));

  const facts = post.usefulFacts.map((fact) => fact.trim()).filter(Boolean);
  if (facts.length > 0) {
    lines.push("Additional explicit facts:");
    for (const fact of facts) lines.push(`- ${fact}`);
  }
  lines.push(`Distillation confidence: ${post.confidence.toFixed(2)}`);
  return lines.join("\n");
}

function field(label: string, value: string | null): string | null {
  const clean = value?.trim();
  return clean ? `${label}: ${clean}` : null;
}

function trimForAgent(value: string): string {
  const clean = value.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > MAX_AGENT_INPUT_CHARS ? `${clean.slice(0, MAX_AGENT_INPUT_CHARS)}\n[truncated]` : clean;
}

function deterministicDistillation(input: { rawText: string; sourceRef: string; pageUrl?: string | null }): string {
  return [
    "Distilled public web listing for extraction.",
    `Source URL: ${input.sourceRef}`,
    input.pageUrl ? `Collected from: ${input.pageUrl}` : null,
    "Raw listing excerpt:",
    trimForAgent(input.rawText),
    "Distillation confidence: 0.50",
  ].filter((line): line is string => line !== null).join("\n");
}

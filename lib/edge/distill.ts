import { generateObject } from "ai";
import { z } from "zod";
import { getExtractionModel } from "../ai/registry";

const MAX_AGENT_INPUT_CHARS = 12_000;
const MAX_DETERMINISTIC_FACTS = 12;
const MAX_DETERMINISTIC_FACT_CHARS = 220;

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
  const facts = deterministicFacts(input.rawText);
  return [
    "Distilled public web listing for extraction.",
    `Source URL: ${input.sourceRef}`,
    input.pageUrl ? `Collected from: ${input.pageUrl}` : null,
    facts.length > 0 ? "Key explicit facts:" : "No clear listing facts found.",
    ...facts.map((fact) => `- ${fact}`),
    `Distillation confidence: ${facts.length > 0 ? "0.55" : "0.30"}`,
  ].filter((line): line is string => line !== null).join("\n");
}

function deterministicFacts(rawText: string): string[] {
  const seen = new Set<string>();
  const facts: string[] = [];
  for (const fragment of rawTextFragments(rawText)) {
    const clean = scrubContactDetails(fragment);
    if (!clean || isJunkLine(clean) || !looksLikeListingFact(clean)) continue;
    const normalized = clean.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    facts.push(clean.length > MAX_DETERMINISTIC_FACT_CHARS ? `${clean.slice(0, MAX_DETERMINISTIC_FACT_CHARS).trim()}...` : clean);
    if (facts.length >= MAX_DETERMINISTIC_FACTS) break;
  }
  return facts;
}

function rawTextFragments(rawText: string): string[] {
  return trimForAgent(rawText)
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/u)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 4);
}

function scrubContactDetails(line: string): string {
  return line
    .replace(/\b(?:\+?84|0)(?:[\s.-]?\d){8,10}\b/g, "")
    .replace(/\b(?:zalo|hotline|liên hệ|lien he|lh|call|phone)\b\s*:?.*$/iu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isJunkLine(line: string): boolean {
  return [
    /^(?:source|page|collected from)\s*:/iu,
    /^(?:đăng nhập|dang nhap|đăng ký|dang ky|lưu tin|luu tin|chia sẻ|chia se|xem thêm|xem them|trang chủ|trang chu)\b/iu,
    /^(?:lọc|loc|sắp xếp|sap xep|tìm kiếm|tim kiem|khu vực|mức giá|muc gia|loại nhà đất|loai nha dat)\b/iu,
    /^(?:cookie|quảng cáo|quang cao|ad\s|ads\b|breadcrumb|menu|home\b)/iu,
  ].some((pattern) => pattern.test(line));
}

function looksLikeListingFact(line: string): boolean {
  return [
    /\b\d+(?:[,.]\d+)?\s*(?:tỷ|tỉ|ty|triệu|tr|vnd|₫|đ)(?:\b|\/m)/iu,
    /\b\d+(?:[,.]\d+)?\s*m(?:2|²)\b/iu,
    /\b(?:pn|phòng ngủ|phong ngu|bedroom|wc|vs)\b/iu,
    /\b(?:bán|ban|cho thuê|cho thue|thuê|thue|giá|gia|thỏa thuận|thoa thuan|thương lượng|thuong luong|tl)\b/iu,
    /\b(?:căn hộ|can ho|chung cư|chung cu|nhà phố|nha pho|shophouse|biệt thự|biet thu|đất|dat|project|dự án|du an)\b/iu,
    /\b(?:block|tower|tòa|toa|tháp|thap|căn|can|lô|lo|unit|mã căn|ma can)\b/iu,
    /\b(?:quận|quan|phường|phuong|đường|duong|hẻm|hem|tp\.?|hcm|hà nội|ha noi|thủ đức|thu duc)\b/iu,
    /\b(?:sổ hồng|so hong|sổ đỏ|so do|shr|pháp lý|phap ly|hợp đồng|hop dong)\b/iu,
    /\b(?:tầng|tang|hướng|huong|view|ban công|ban cong|nội thất|noi that|bàn giao|ban giao)\b/iu,
  ].some((pattern) => pattern.test(line));
}

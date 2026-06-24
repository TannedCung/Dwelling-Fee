import * as cheerio from "cheerio";
import type { CollectedItem } from "./fetchers";

const DEFAULT_MAX_TEXT_CHARS = 24_000;
const DEFAULT_DROP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "header",
  "footer",
  "nav",
  "[aria-hidden='true']",
  ".ads",
  ".advertisement",
  ".breadcrumb",
  ".cookie",
  ".menu",
  ".modal",
  ".pagination",
  ".share",
  ".social",
];

export interface HttpFetcherConfig {
  contentSelector?: string;
  itemSelector?: string;
  linkSelector?: string;
  dropSelectors?: string[];
  maxTextChars?: number;
}

type ExtractionConfig = Required<Pick<HttpFetcherConfig, "dropSelectors" | "maxTextChars">> &
  Pick<HttpFetcherConfig, "contentSelector" | "itemSelector" | "linkSelector">;

export function extractPageItems(html: string, pageUrl: URL, config: Partial<HttpFetcherConfig> = {}, capturedAt = new Date()) {
  const resolved = configToExtractionConfig(config);
  const $ = cheerio.load(html);
  for (const selector of resolved.dropSelectors) $(selector).remove();

  const metadata = extractMetadata($);
  const pageCanonical = canonicalUrl(pageUrl);
  const items: CollectedItem[] = [];
  const seenSourceRefs = new Set<string>();

  if (resolved.itemSelector) {
    $(resolved.itemSelector).each((index, element) => {
      const item = $(element);
      const itemUrl = itemLink($, item, pageUrl, resolved.linkSelector ?? null);
      const root = resolved.contentSelector ? item.find(resolved.contentSelector).first() : itemContentRoot(item);
      const text = cleanText(root).slice(0, resolved.maxTextChars);
      if (!text) return;
      const sourceRef = itemUrl ? canonicalUrl(itemUrl) : `${pageCanonical}#item-${index + 1}`;
      if (seenSourceRefs.has(sourceRef)) return;
      seenSourceRefs.add(sourceRef);
      items.push({
        sourceRef,
        pageUrl: pageCanonical,
        sourceType: "web",
        capturedAt,
        text: pageText(sourceRef, pageCanonical, metadata.title, joinUseful([metadata.summary, text]), metadata.structured),
      });
    });
  } else {
    const root = selectContentRoot($, resolved.contentSelector ?? null);
    const text = cleanText(root).slice(0, resolved.maxTextChars);
    const body = joinUseful([metadata.summary, text]);
    if (body) {
      items.push({
        sourceRef: pageCanonical,
        pageUrl: pageCanonical,
        sourceType: "web",
        capturedAt,
        text: pageText(pageCanonical, null, metadata.title, body, metadata.structured),
      });
    }
  }

  return { items, links: extractLinksFromDom($, pageUrl, resolved.linkSelector ?? null) };
}

function configToExtractionConfig(config: Partial<HttpFetcherConfig>): ExtractionConfig {
  return {
    contentSelector: config.contentSelector || undefined,
    itemSelector: config.itemSelector || undefined,
    linkSelector: config.linkSelector || undefined,
    dropSelectors: [...DEFAULT_DROP_SELECTORS, ...(config.dropSelectors ?? [])],
    maxTextChars: config.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS,
  };
}

function selectContentRoot($: cheerio.CheerioAPI, selector: string | null) {
  if (selector) {
    const selected = $(selector).first();
    if (selected.length > 0) return selected;
  }
  for (const fallback of ["main", "article", "[role='main']", "body"]) {
    const selected = $(fallback).first();
    if (selected.length > 0) return selected;
  }
  return $.root();
}

function itemLink($: cheerio.CheerioAPI, item: cheerio.Cheerio<any>, pageUrl: URL, selector: string | null): URL | null {
  const link = selector
    ? item.find(selector).first()
    : item.is("a[href]")
      ? item
      : item.find("a[href]").first();
  const href = link.attr("href");
  if (!href) return null;
  try {
    const url = new URL(href, pageUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function itemContentRoot(item: cheerio.Cheerio<any>) {
  if (!item.is("a[href]")) return item;
  const cardSelector = [
    "article",
    "li",
    "[data-testid*='card']",
    "[data-testid*='listing']",
    "[class*='card']",
    "[class*='listing']",
    "[class*='product']",
  ].join(",");
  const parent = item.parent();
  const card = parent.closest(cardSelector);
  if (card.length > 0) return card;
  return parent.length > 0 ? parent : item;
}

function extractMetadata($: cheerio.CheerioAPI) {
  const title = cleanSpaces($("title").first().text()) || null;
  const description =
    cleanSpaces($("meta[name='description']").attr("content") ?? $("meta[property='og:description']").attr("content") ?? "") || null;
  const ogTitle = cleanSpaces($("meta[property='og:title']").attr("content") ?? "") || null;
  const structured = extractStructuredData($);
  return { title: ogTitle ?? title, summary: description, structured };
}

function extractStructuredData($: cheerio.CheerioAPI): string | null {
  const lines: string[] = [];
  $("script[type*='ld+json']").each((_index, element) => {
    const raw = $(element).text();
    for (const entry of parseJsonLd(raw)) {
      const values = [
        stringish(entry.name),
        stringish(entry.description),
        stringish(entry.address),
        stringish(entry.floorSize),
        stringish(entry.numberOfRooms),
        stringish(entry.offers),
      ].filter(Boolean);
      if (values.length > 0) lines.push(values.join(" | "));
    }
  });
  return lines.length > 0 ? lines.slice(0, 5).join("\n") : null;
}

function parseJsonLd(raw: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.flatMap((value) => {
      if (!isRecord(value)) return [];
      const graph = value["@graph"];
      return Array.isArray(graph) ? graph.filter(isRecord) : [value];
    });
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringish(value: unknown): string | null {
  if (typeof value === "string") return cleanSpaces(value) || null;
  if (typeof value === "number") return String(value);
  if (isRecord(value)) {
    const useful = ["name", "streetAddress", "addressLocality", "addressRegion", "price", "priceCurrency", "value", "unitText"]
      .map((key) => stringish(value[key]))
      .filter(Boolean);
    return useful.length > 0 ? useful.join(" ") : null;
  }
  return null;
}

function cleanText(root: cheerio.Cheerio<any>): string {
  root.find("br").replaceWith("\n");
  const text = root.text();
  return text
    .split(/\n+/)
    .map(cleanSpaces)
    .filter(Boolean)
    .join("\n");
}

function cleanSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function joinUseful(values: Array<string | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value && value.trim())).join("\n");
}

function pageText(sourceRef: string, pageUrl: string | null, title: string | null, text: string, structured: string | null): string {
  return [
    `Source: ${sourceRef}`,
    pageUrl ? `Page: ${pageUrl}` : null,
    title ? `Title: ${title}` : null,
    structured ? `Structured data:\n${structured}` : null,
    text,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function visibleText(input: string, maxChars = DEFAULT_MAX_TEXT_CHARS): string {
  const $ = cheerio.load(input);
  for (const selector of DEFAULT_DROP_SELECTORS) $(selector).remove();
  return cleanText(selectContentRoot($, null)).slice(0, maxChars);
}

export function extractLinks(html: string, base: URL): URL[] {
  const $ = cheerio.load(html);
  return extractLinksFromDom($, base, null);
}

function extractLinksFromDom($: cheerio.CheerioAPI, base: URL, selector: string | null): URL[] {
  const out: URL[] = [];
  const seen = new Set<string>();
  $(selector ?? "a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href || href.startsWith("#") || /^(?:mailto|tel|javascript):/i.test(href)) return;
    try {
      const url = new URL(href, base);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      const canonical = canonicalUrl(url);
      if (seen.has(canonical)) return;
      seen.add(canonical);
      out.push(new URL(canonical));
    } catch {
      // Ignore malformed links from source HTML.
    }
  });
  return out;
}

export function canonicalUrl(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = "";
  copy.hostname = copy.hostname.toLowerCase();
  copy.searchParams.sort();
  if (copy.pathname.length > 1) copy.pathname = copy.pathname.replace(/\/+$/, "");
  return copy.href;
}

import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import robotsParser from "robots-parser";
import type {
  CollectedItem,
  CollectionFetchContext,
  CollectionFetchResult,
  CollectionFetcher,
  CollectionPageCacheEntry,
  CollectionPageResult,
  CollectionSourceRef,
} from "./fetchers";

const DEFAULT_MAX_PAGES = 10;
const MAX_PAGES_LIMIT = 50;
const DEFAULT_MAX_DEPTH = 1;
const MAX_DEPTH_LIMIT = 5;
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY_LIMIT = 5;
const DEFAULT_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TEXT_CHARS = 24_000;
const DEFAULT_USER_AGENT = "DwellingFeeBot/0.1 (research crawler; contact: local-user)";
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

type FetchLike = typeof fetch;

export interface HttpFetcherConfig {
  allowedDomains?: string[];
  maxPages?: number;
  maxDepth?: number;
  maxConcurrency?: number;
  followLinks?: boolean;
  useSitemaps?: boolean;
  includeUrlPatterns?: string[];
  excludeUrlPatterns?: string[];
  requestDelayMs?: number;
  timeoutMs?: number;
  maxTextChars?: number;
  userAgent?: string;
  contentSelector?: string;
  itemSelector?: string;
  linkSelector?: string;
  dropSelectors?: string[];
}

interface ResolvedConfig {
  allowedDomains: string[];
  maxPages: number;
  maxDepth: number;
  maxConcurrency: number;
  followLinks: boolean;
  useSitemaps: boolean;
  includeUrlPatterns: RegExp[];
  excludeUrlPatterns: RegExp[];
  requestDelayMs: number;
  timeoutMs: number;
  maxTextChars: number;
  userAgent: string;
  contentSelector: string | null;
  itemSelector: string | null;
  linkSelector: string | null;
  dropSelectors: string[];
}

interface HttpFetcherDeps {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

interface CrawlTarget {
  url: URL;
  depth: number;
}

interface ProcessedPage {
  page: CollectionPageResult;
  items: CollectedItem[];
  links: URL[];
}

interface FetchedPage {
  url: URL;
  status: number;
  contentType: string;
  body: string;
  bytesFetched: number;
  durationMs: number;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: Date;
}

export function createHttpFetcher(deps: HttpFetcherDeps = {}): CollectionFetcher {
  const fetchImpl = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => new Date());

  return {
    async fetch(source, ctx = {}) {
      const seed = parseHttpUrl(source.url);
      const config = parseHttpConfig(source, seed);
      const robots = new RobotsCache(fetchImpl, config);
      const limiter = pLimit(config.maxConcurrency);
      const throttle = createThrottle(config.requestDelayMs, sleep, now);
      const queue: CrawlTarget[] = [{ url: new URL(canonicalUrl(seed)), depth: 0 }];
      const queued = new Set(queue.map((t) => canonicalUrl(t.url)));
      const visited = new Set<string>();
      const result: CollectionFetchResult = { items: [], pages: [] };

      if (config.useSitemaps) {
        for (const sitemap of await robots.sitemaps(seed)) {
          maybeQueue(queue, queued, visited, sitemap, 0, config);
        }
      }

      while (queue.length > 0 && visited.size < config.maxPages) {
        const batch: CrawlTarget[] = [];
        while (queue.length > 0 && batch.length < config.maxConcurrency && visited.size + batch.length < config.maxPages) {
          const target = queue.shift()!;
          const canonical = canonicalUrl(target.url);
          queued.delete(canonical);
          if (visited.has(canonical)) continue;
          visited.add(canonical);
          batch.push(target);
        }
        if (batch.length === 0) continue;

        const processed = await Promise.all(
          batch.map((target) =>
            limiter(() => processTarget(fetchImpl, robots, throttle, target, config, ctx.cachedPages, now)),
          ),
        );
        for (const page of processed) {
          result.pages.push(page.page);
          result.items.push(...page.items);
          const shouldQueueLinks = config.followLinks || looksLikeSitemap(new URL(page.page.canonicalUrl));
          if (shouldQueueLinks && page.page.status !== "failed") {
            for (const link of page.links) {
              maybeQueue(queue, queued, visited, link, pageDepth(page.page.canonicalUrl, batch) + 1, config);
            }
          }
        }
      }

      return result;
    },
  };
}

export const httpFetcher = createHttpFetcher();

function parseHttpUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("http collection source must use http or https");
  }
  return url;
}

export function parseHttpConfig(source: CollectionSourceRef, seed: URL): ResolvedConfig {
  const input = isRecord(source.config) ? source.config : {};
  const allowedDomains = stringArray(input.allowedDomains);
  if (allowedDomains.length === 0) allowedDomains.push(seed.hostname);

  return {
    allowedDomains: allowedDomains.map(normalizeHost),
    maxPages: clampInt(input.maxPages, DEFAULT_MAX_PAGES, 1, MAX_PAGES_LIMIT),
    maxDepth: clampInt(input.maxDepth, DEFAULT_MAX_DEPTH, 0, MAX_DEPTH_LIMIT),
    maxConcurrency: clampInt(input.maxConcurrency, DEFAULT_CONCURRENCY, 1, MAX_CONCURRENCY_LIMIT),
    followLinks: input.followLinks === true,
    useSitemaps: input.useSitemaps === true || looksLikeSitemap(seed),
    includeUrlPatterns: regexArray(input.includeUrlPatterns, "includeUrlPatterns"),
    excludeUrlPatterns: regexArray(input.excludeUrlPatterns, "excludeUrlPatterns"),
    requestDelayMs: clampInt(input.requestDelayMs, DEFAULT_DELAY_MS, 0, 60_000),
    timeoutMs: clampInt(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 60_000),
    maxTextChars: clampInt(input.maxTextChars, DEFAULT_MAX_TEXT_CHARS, 1000, 100_000),
    userAgent: typeof input.userAgent === "string" && input.userAgent.trim() ? input.userAgent.trim() : DEFAULT_USER_AGENT,
    contentSelector: stringValue(input.contentSelector),
    itemSelector: stringValue(input.itemSelector),
    linkSelector: stringValue(input.linkSelector),
    dropSelectors: [...DEFAULT_DROP_SELECTORS, ...stringArray(input.dropSelectors)],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function regexArray(value: unknown, field: string): RegExp[] {
  return stringArray(value).map((pattern) => {
    try {
      return new RegExp(pattern);
    } catch {
      throw new Error(`invalid ${field} regex: ${pattern}`);
    }
  });
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "");
}

function assertAllowedDomain(url: URL, allowedDomains: string[]): void {
  if (!domainAllowed(url.hostname, allowedDomains)) {
    throw new Error(`domain not allowed for collection source: ${url.hostname}`);
  }
}

function domainAllowed(host: string, allowedDomains: string[]): boolean {
  const normalized = normalizeHost(host);
  return allowedDomains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function urlPatternAllowed(url: string, config: ResolvedConfig): boolean {
  if (looksLikeAsset(url)) return false;
  if (config.excludeUrlPatterns.some((pattern) => pattern.test(url))) return false;
  if (config.includeUrlPatterns.length === 0) return true;
  return config.includeUrlPatterns.some((pattern) => pattern.test(url));
}

function looksLikeAsset(url: string): boolean {
  return /\.(?:avif|css|gif|ico|jpe?g|js|json|pdf|png|svg|webp|zip)(?:[?#]|$)/i.test(url);
}

function looksLikeSitemap(url: URL): boolean {
  return /sitemap.*\.xml(?:\.gz)?$/i.test(url.pathname) || /\/sitemap(?:_index)?\.xml$/i.test(url.pathname);
}

function maybeQueue(
  queue: CrawlTarget[],
  queued: Set<string>,
  visited: Set<string>,
  url: URL,
  depth: number,
  config: ResolvedConfig,
): void {
  const canonical = canonicalUrl(url);
  if (depth > config.maxDepth) return;
  if (visited.has(canonical) || queued.has(canonical)) return;
  if (!domainAllowed(url.hostname, config.allowedDomains)) return;
  if (!urlPatternAllowed(canonical, config) && !looksLikeSitemap(url)) return;
  if (queued.size + visited.size >= config.maxPages * 4) return;
  queue.push({ url: new URL(canonical), depth });
  queued.add(canonical);
}

function pageDepth(canonicalUrlValue: string, batch: CrawlTarget[]): number {
  return batch.find((target) => canonicalUrl(target.url) === canonicalUrlValue)?.depth ?? 0;
}

async function processTarget(
  fetchImpl: FetchLike,
  robots: RobotsCache,
  throttle: () => Promise<void>,
  target: CrawlTarget,
  config: ResolvedConfig,
  cachedPages: Map<string, CollectionPageCacheEntry> | undefined,
  now: () => Date,
): Promise<ProcessedPage> {
  const canonical = canonicalUrl(target.url);
  try {
    assertAllowedDomain(target.url, config.allowedDomains);
    await robots.assertAllowed(target.url);
    await throttle();

    const cache = cachedPages?.get(canonical);
    const fetched = await fetchPage(fetchImpl, target.url, config, cache, now);
    if (fetched.status === 304) {
      return {
        page: pageResult(canonical, "skipped_unchanged", {
          httpStatus: 304,
          etag: fetched.etag ?? cache?.etag ?? null,
          lastModified: fetched.lastModified ?? cache?.lastModified ?? null,
          fetchDurationMs: fetched.durationMs,
          bytesFetched: 0,
          fetchedAt: fetched.fetchedAt,
        }),
        items: [],
        links: [],
      };
    }

    const contentHash = sha256(fetched.body);
    const isXml = isXmlPage(fetched);
    if (isXml) {
      const links = extractSitemapUrls(fetched.body, target.url, config);
      return {
        page: pageResult(canonical, cache?.contentHash === contentHash ? "skipped_unchanged" : "fetched", {
          httpStatus: fetched.status,
          contentHash,
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          fetchDurationMs: fetched.durationMs,
          bytesFetched: fetched.bytesFetched,
          textLength: 0,
          itemCount: 0,
          fetchedAt: fetched.fetchedAt,
        }),
        items: [],
        links,
      };
    }

    const extracted = extractPageItems(
      fetched.body,
      target.url,
      {
        contentSelector: config.contentSelector ?? undefined,
        itemSelector: config.itemSelector ?? undefined,
        linkSelector: config.linkSelector ?? undefined,
        dropSelectors: config.dropSelectors,
        maxTextChars: config.maxTextChars,
      },
      now(),
    );
    const combinedText = extracted.items.map((item) => item.text).join("\n\n---\n\n");
    const textHash = sha256(combinedText);
    const unchanged = cache?.contentHash === contentHash || cache?.textHash === textHash;
    return {
      page: pageResult(canonical, unchanged ? "skipped_unchanged" : "fetched", {
        httpStatus: fetched.status,
        contentHash,
        textHash,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        fetchDurationMs: fetched.durationMs,
        bytesFetched: fetched.bytesFetched,
        textLength: combinedText.length,
        itemCount: extracted.items.length,
        fetchedAt: fetched.fetchedAt,
      }),
      items: unchanged ? [] : extracted.items,
      links: extracted.links,
    };
  } catch (e) {
    return {
      page: pageResult(canonical, "failed", { error: e instanceof Error ? e.message : "fetch failed", fetchedAt: now() }),
      items: [],
      links: [],
    };
  }
}

function pageResult(
  canonicalUrl: string,
  status: CollectionPageResult["status"],
  fields: Partial<Omit<CollectionPageResult, "canonicalUrl" | "status">>,
): CollectionPageResult {
  return { canonicalUrl, status, ...fields };
}

async function fetchPage(
  fetchImpl: FetchLike,
  url: URL,
  config: ResolvedConfig,
  cache: CollectionPageCacheEntry | undefined,
  now: () => Date,
): Promise<FetchedPage> {
  const started = Date.now();
  const res = await fetchWithTimeout(fetchImpl, url, config, cache);
  const durationMs = Date.now() - started;
  if (res.status === 304) {
    return responseToPage(url, res, "", 0, durationMs, now());
  }
  if (!res.ok) throw new Error(`fetch failed for ${url.href}: HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") ?? "";
  const supported =
    contentType === "" ||
    contentType.includes("text/html") ||
    contentType.includes("text/plain") ||
    contentType.includes("xml");
  if (!supported) throw new Error(`unsupported content type for ${url.href}: ${contentType}`);

  const body = await res.text();
  return responseToPage(url, res, body, new TextEncoder().encode(body).byteLength, durationMs, now());
}

function responseToPage(url: URL, res: Response, body: string, bytesFetched: number, durationMs: number, fetchedAt: Date): FetchedPage {
  return {
    url,
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    body,
    bytesFetched,
    durationMs,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    fetchedAt,
  };
}

function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: URL,
  config: ResolvedConfig,
  cache: CollectionPageCacheEntry | undefined,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const headers: Record<string, string> = {
    "user-agent": config.userAgent,
    accept: "text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.5",
  };
  if (cache?.etag) headers["if-none-match"] = cache.etag;
  if (cache?.lastModified) headers["if-modified-since"] = cache.lastModified;

  return fetchImpl(url, { headers, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function isXmlPage(page: FetchedPage): boolean {
  return (
    page.contentType.includes("xml") ||
    looksLikeSitemap(page.url) ||
    /^\s*<\?xml/i.test(page.body) ||
    /^\s*<(?:urlset|sitemapindex)\b/i.test(page.body)
  );
}

export function extractPageItems(html: string, pageUrl: URL, config: Partial<HttpFetcherConfig> = {}, capturedAt = new Date()) {
  const resolved = configToExtractionConfig(config);
  const $ = cheerio.load(html);
  for (const selector of resolved.dropSelectors) $(selector).remove();

  const metadata = extractMetadata($);
  const pageCanonical = canonicalUrl(pageUrl);
  const items: CollectedItem[] = [];

  if (resolved.itemSelector) {
    $(resolved.itemSelector).each((index, element) => {
      const item = $(element);
      const itemUrl = itemLink($, item, pageUrl, resolved.linkSelector);
      const root = resolved.contentSelector ? item.find(resolved.contentSelector).first() : item;
      const text = cleanText(root).slice(0, resolved.maxTextChars);
      if (!text) return;
      const sourceRef = itemUrl ? canonicalUrl(itemUrl) : `${pageCanonical}#item-${index + 1}`;
      items.push({
        sourceRef,
        pageUrl: pageCanonical,
        sourceType: "web",
        capturedAt,
        text: pageText(sourceRef, pageCanonical, metadata.title, joinUseful([metadata.summary, text]), metadata.structured),
      });
    });
  } else {
    const root = selectContentRoot($, resolved.contentSelector);
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

  return { items, links: extractLinksFromDom($, pageUrl, resolved) };
}

function configToExtractionConfig(config: Partial<HttpFetcherConfig>): Pick<
  ResolvedConfig,
  "contentSelector" | "dropSelectors" | "itemSelector" | "linkSelector" | "maxTextChars"
> {
  return {
    contentSelector: config.contentSelector ?? null,
    itemSelector: config.itemSelector ?? null,
    linkSelector: config.linkSelector ?? null,
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
  const link = selector ? item.find(selector).first() : item.find("a[href]").first();
  const href = link.attr("href");
  if (!href) return null;
  try {
    const url = new URL(href, pageUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
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
  return extractLinksFromDom($, base, configToExtractionConfig({}));
}

function extractLinksFromDom($: cheerio.CheerioAPI, base: URL, config: Pick<ResolvedConfig, "linkSelector">): URL[] {
  const out: URL[] = [];
  const seen = new Set<string>();
  const selector = config.linkSelector ?? "a[href]";
  $(selector).each((_index, element) => {
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

function extractSitemapUrls(xml: string, base: URL, config: ResolvedConfig): URL[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: URL[] = [];
  $("loc").each((_index, element) => {
    const raw = cleanSpaces($(element).text());
    if (!raw) return;
    try {
      const url = new URL(raw, base);
      if (domainAllowed(url.hostname, config.allowedDomains) && urlPatternAllowed(canonicalUrl(url), config)) {
        out.push(url);
      }
    } catch {
      // Ignore malformed sitemap URLs.
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createThrottle(delayMs: number, sleep: (ms: number) => Promise<void>, now: () => Date) {
  let nextAt = 0;
  return async () => {
    if (delayMs <= 0) return;
    const current = now().getTime();
    const wait = Math.max(0, nextAt - current);
    nextAt = Math.max(current, nextAt) + delayMs;
    if (wait > 0) await sleep(wait);
  };
}

class RobotsCache {
  private readonly byOrigin = new Map<string, Promise<{ parser: ReturnType<typeof robotsParser>; sitemaps: URL[] }>>();

  constructor(private readonly fetchImpl: FetchLike, private readonly config: ResolvedConfig) {}

  async assertAllowed(url: URL): Promise<void> {
    const rules = await this.rulesFor(url);
    if (!rules.parser.isAllowed(url.href, this.config.userAgent)) {
      throw new Error(`robots.txt disallows collection for ${url.href}`);
    }
  }

  async sitemaps(url: URL): Promise<URL[]> {
    return (await this.rulesFor(url)).sitemaps;
  }

  private rulesFor(url: URL): Promise<{ parser: ReturnType<typeof robotsParser>; sitemaps: URL[] }> {
    const origin = url.origin;
    const existing = this.byOrigin.get(origin);
    if (existing) return existing;
    const promise = fetchRobots(this.fetchImpl, new URL("/robots.txt", origin), this.config);
    this.byOrigin.set(origin, promise);
    return promise;
  }
}

async function fetchRobots(fetchImpl: FetchLike, robotsUrl: URL, config: ResolvedConfig) {
  const res = await fetchWithTimeout(fetchImpl, robotsUrl, config, undefined);
  if (res.status === 404) return { parser: robotsParser(robotsUrl.href, ""), sitemaps: [] };
  if (!res.ok) throw new Error(`could not check robots.txt for ${robotsUrl.origin}: HTTP ${res.status}`);
  const body = await res.text();
  return {
    parser: robotsParser(robotsUrl.href, body),
    sitemaps: body
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*sitemap\s*:\s*(\S+)/i)?.[1])
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => {
        try {
          return [new URL(value, robotsUrl)];
        } catch {
          return [];
        }
      }),
  };
}

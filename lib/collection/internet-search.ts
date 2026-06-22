export const INTERNET_SEARCH_EVIDENCE_TIER = "tier_2_unconfirmed" as const;
export const INTERNET_SEARCH_EVIDENCE_LABEL = "Tier 2" as const;
export const INTERNET_SEARCH_CAVEAT =
  "Internet search evidence is unconfirmed. Use it as research context only until verified by source-backed review.";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export interface InternetSearchInput {
  query: string;
  purpose?: string;
  limit?: number;
  country?: string;
  searchLang?: string;
}

export interface InternetSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt: string | null;
  tier: typeof INTERNET_SEARCH_EVIDENCE_TIER;
  tierLabel: typeof INTERNET_SEARCH_EVIDENCE_LABEL;
  caveat: typeof INTERNET_SEARCH_CAVEAT;
}

export interface InternetSearchOutput {
  query: string;
  purpose: string | null;
  retrievedAt: string;
  provider: "brave";
  tier: typeof INTERNET_SEARCH_EVIDENCE_TIER;
  tierLabel: typeof INTERNET_SEARCH_EVIDENCE_LABEL;
  caveat: typeof INTERNET_SEARCH_CAVEAT;
  results: InternetSearchResult[];
  warnings: string[];
}

interface SearchDeps {
  fetch?: typeof fetch;
  now?: () => Date;
  apiKey?: string;
}

interface BraveSearchResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  page_age?: unknown;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveSearchResult[];
  };
}

export async function searchInternetForProjectInformation(
  input: InternetSearchInput,
  deps: SearchDeps = {},
): Promise<InternetSearchOutput> {
  const query = input.query.trim();
  if (!query) throw new Error("search query is required");

  const now = deps.now ?? (() => new Date());
  const apiKey = deps.apiKey ?? process.env.BRAVE_SEARCH_API_KEY;
  const base = emptyOutput(input, now());

  if (!apiKey) {
    return {
      ...base,
      warnings: [
        "BRAVE_SEARCH_API_KEY is not configured; internet project-information search is unavailable.",
      ],
    };
  }

  const fetchImpl = deps.fetch ?? fetch;
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(clampLimit(input.limit)));
  url.searchParams.set("country", normalizeCountry(input.country));
  url.searchParams.set("search_lang", normalizeSearchLang(input.searchLang));

  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    return {
      ...base,
      warnings: [`Brave Search request failed with HTTP ${response.status}.`],
    };
  }

  const body = (await response.json()) as BraveSearchResponse;
  const results = (body.web?.results ?? [])
    .map(toInternetSearchResult)
    .filter((result): result is InternetSearchResult => result !== null)
    .slice(0, clampLimit(input.limit));

  return { ...base, results };
}

function emptyOutput(input: InternetSearchInput, retrievedAt: Date): InternetSearchOutput {
  return {
    query: input.query.trim(),
    purpose: input.purpose?.trim() || null,
    retrievedAt: retrievedAt.toISOString(),
    provider: "brave",
    tier: INTERNET_SEARCH_EVIDENCE_TIER,
    tierLabel: INTERNET_SEARCH_EVIDENCE_LABEL,
    caveat: INTERNET_SEARCH_CAVEAT,
    results: [],
    warnings: [],
  };
}

function toInternetSearchResult(result: BraveSearchResult): InternetSearchResult | null {
  const title = stringValue(result.title);
  const url = stringValue(result.url);
  if (!title || !url) return null;

  return {
    title,
    url,
    snippet: stringValue(result.description) ?? "",
    source: hostname(url),
    publishedAt: stringValue(result.page_age),
    tier: INTERNET_SEARCH_EVIDENCE_TIER,
    tierLabel: INTERNET_SEARCH_EVIDENCE_LABEL,
    caveat: INTERNET_SEARCH_CAVEAT,
  };
}

function clampLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function normalizeCountry(value: string | undefined): string {
  return value?.trim().toUpperCase() || "VN";
}

function normalizeSearchLang(value: string | undefined): string {
  return value?.trim().toLowerCase() || "vi";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

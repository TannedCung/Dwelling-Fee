/** Strip Vietnamese diacritics, lowercase, drop punctuation, collapse whitespace. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Significant tokens (length ≥ 3) from a normalized string. */
export function tokens(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length >= 3);
}

/** Jaccard similarity over token sets. */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}

const CATEGORY_PREFIXES = [
  "nhà phố",
  "nha pho",
  "shophouse",
  "shop house",
  "biệt thự",
  "biet thu",
  "villa",
  "căn hộ",
  "can ho",
  "chung cư",
  "chung cu",
  "đất nền",
  "dat nen",
  "dự án",
  "du an",
  "project",
];

/**
 * Move common real-estate category words out of a name and into reusable tags.
 * Example: "nhà phố ABC" -> canonical "ABC", tags ["nhà phố"].
 */
export function splitNameTags(raw: string | null | undefined): { name: string | null; tags: string[] } {
  const value = raw?.trim();
  if (!value) return { name: null, tags: [] };

  for (const prefix of CATEGORY_PREFIXES) {
    const re = new RegExp(`^${prefix}\\s+(.+)$`, "iu");
    const match = value.match(re);
    if (match?.[1]?.trim()) {
      return { name: match[1].trim(), tags: [prefix] };
    }
  }

  return { name: value, tags: [] };
}

export function uniqueText(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    const key = normalizeName(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

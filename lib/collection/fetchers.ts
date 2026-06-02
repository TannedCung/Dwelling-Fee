/**
 * Collection fetchers (Phase 3 scaffold). A fetcher turns a registered source
 * into a list of raw text items, each with a stable `sourceRef` so re-runs are
 * idempotent (raw_signal dedups on source_type + source_ref + content_hash).
 *
 * Today only a deterministic `stub` fetcher exists — it returns realistic sample
 * listings without touching the network, so the whole pipeline (schedule → fetch
 * → ingestSignal → extract → resolve → observations) is wired end-to-end and
 * testable. A real `http` fetcher (Firecrawl / fetch+readability) drops in here
 * behind the same interface when crawl targets + creds are decided.
 */

export interface CollectionSourceRef {
  id: string;
  label: string;
  url: string;
  kind: "stub" | "http";
  config: unknown;
}

export interface CollectedItem {
  /** Stable identifier for this item within the source — drives idempotency. */
  sourceRef: string;
  /** Raw listing text, fed verbatim into ingestSignal(). */
  text: string;
  capturedAt?: Date;
}

export interface CollectionFetcher {
  fetch(source: CollectionSourceRef): Promise<CollectedItem[]>;
}

// Deterministic sample listings — phrasing mirrors real VN broker posts so the
// extractor exercises its shorthand decoding. Stable across runs ⇒ re-runs dedup.
const SAMPLE_TEMPLATES = [
  "Cần bán căn hộ {project}, {area}m², {beds}PN, view đẹp. Giá {priceTy} tỷ, sổ hồng. LH chính chủ.",
  "Bán nhà phố {project}, diện tích {area}m². Giá {priceTy} tỷ TL nhẹ. Pháp lý đầy đủ.",
  "Cho thuê căn hộ {project} {area}m² {beds}PN, full nội thất. Giá {priceTrieu} triệu/tháng.",
];

const PROJECTS = ["Vinhomes Grand Park", "Masteri An Phú", "The Sun Avenue", "Eco Green Sài Gòn"];

// Simple deterministic PRNG so a given source always yields the same items.
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const stubFetcher: CollectionFetcher = {
  async fetch(source) {
    const rand = seeded(source.id || source.url);
    const count = 3;
    const items: CollectedItem[] = [];
    for (let i = 0; i < count; i++) {
      const tpl = SAMPLE_TEMPLATES[i % SAMPLE_TEMPLATES.length]!;
      const project = PROJECTS[Math.floor(rand() * PROJECTS.length)]!;
      const area = 45 + Math.floor(rand() * 80);
      const beds = 1 + Math.floor(rand() * 3);
      const priceTy = (2 + rand() * 6).toFixed(1);
      const priceTrieu = 8 + Math.floor(rand() * 20);
      const text = tpl
        .replaceAll("{project}", project)
        .replaceAll("{area}", String(area))
        .replaceAll("{beds}", String(beds))
        .replaceAll("{priceTy}", priceTy)
        .replaceAll("{priceTrieu}", String(priceTrieu));
      items.push({ sourceRef: `${source.url}#sample-${i + 1}`, text });
    }
    return items;
  },
};

/** Placeholder for the real crawler — wired later behind this same interface. */
export const httpFetcher: CollectionFetcher = {
  async fetch() {
    throw new Error(
      "http fetcher not implemented yet — set a crawl provider (e.g. Firecrawl) and credentials first.",
    );
  },
};

export function fetcherFor(kind: "stub" | "http"): CollectionFetcher {
  return kind === "http" ? httpFetcher : stubFetcher;
}

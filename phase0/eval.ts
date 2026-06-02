import { extract, EXTRACTOR_VERSION } from "../lib/extraction/extract";
import { DATASET, type Golden } from "./dataset";
import type { PropertyExtraction } from "../lib/extraction/schema";

/**
 * Phase 0 evaluation harness (docs/design.md §11).
 *
 * Runs the extractor over the golden set, aligns predicted properties to expected ones,
 * and reports per-field accuracy plus property-level precision/recall. This is the gate
 * that tells us whether extraction is good enough to build infrastructure around.
 */

const SCORED_FIELDS = [
  "type", "listingType", "priceBasis", "dealStatus", "isNegotiable", "bedrooms", "priceVnd", "areaM2",
] as const;
type ScoredField = (typeof SCORED_FIELDS)[number];

function priceMatches(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005); // 0.5% tolerance
}
function areaMatches(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 0.5;
}
function fieldMatches(field: ScoredField, pred: PropertyExtraction, exp: Golden): boolean {
  switch (field) {
    case "priceVnd": return priceMatches(pred.priceVnd, exp.priceVnd);
    case "areaM2": return areaMatches(pred.areaM2, exp.areaM2);
    case "bedrooms": return pred.bedrooms === exp.bedrooms;
    default: return pred[field] === exp[field];
  }
}
function locationMatches(pred: PropertyExtraction, exp: Golden): boolean | null {
  if (!exp.locationContains) return null; // not asserted
  return (pred.locationText ?? "").toLowerCase().includes(exp.locationContains.toLowerCase());
}

/** Greedy match: pair each expected property to the predicted one sharing the most key fields. */
function alignByCharacteristics(preds: PropertyExtraction[], golds: Golden[]) {
  const usedPred = new Set<number>();
  const pairs: { pred: PropertyExtraction; exp: Golden }[] = [];
  const missed: Golden[] = [];

  for (const exp of golds) {
    let bestIdx = -1;
    let bestScore = -1;
    preds.forEach((p, i) => {
      if (usedPred.has(i)) return;
      const score =
        (priceMatches(p.priceVnd, exp.priceVnd) ? 2 : 0) +
        (areaMatches(p.areaM2, exp.areaM2) ? 1 : 0) +
        (p.type === exp.type ? 1 : 0);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    });
    if (bestIdx >= 0) { usedPred.add(bestIdx); pairs.push({ pred: preds[bestIdx]!, exp }); }
    else missed.push(exp);
  }
  const spurious = preds.filter((_, i) => !usedPred.has(i));
  return { pairs, missed, spurious };
}

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));

async function run() {
  console.log(`\nPhase 0 extraction eval — extractor: ${EXTRACTOR_VERSION}`);
  console.log(`Cases: ${DATASET.length}\n${"─".repeat(64)}`);

  const fieldHits: Record<ScoredField, number> = Object.fromEntries(
    SCORED_FIELDS.map((f) => [f, 0]),
  ) as Record<ScoredField, number>;
  const fieldTotal: Record<ScoredField, number> = { ...fieldHits };
  let locHits = 0, locTotal = 0;
  let matchedPairs = 0, totalMissed = 0, totalSpurious = 0, totalExpected = 0;
  let failures = 0;

  for (const c of DATASET) {
    let preds: PropertyExtraction[];
    try {
      preds = (await extract(c.text)).properties;
    } catch (e) {
      failures++;
      console.log(`✗ ${c.id}: extraction error — ${e instanceof Error ? e.message : e}`);
      continue;
    }

    const { pairs, missed, spurious } = alignByCharacteristics(preds, c.expected);
    totalExpected += c.expected.length;
    matchedPairs += pairs.length;
    totalMissed += missed.length;
    totalSpurious += spurious.length;

    const caseFieldErrors: string[] = [];
    for (const { pred, exp } of pairs) {
      for (const f of SCORED_FIELDS) {
        fieldTotal[f]++;
        if (fieldMatches(f, pred, exp)) fieldHits[f]++;
        else caseFieldErrors.push(`${f}: got ${fmt2(pred[f])} ≠ exp ${fmt2(exp[f])}`);
      }
      const loc = locationMatches(pred, exp);
      if (loc !== null) { locTotal++; if (loc) locHits++; else caseFieldErrors.push(`location: "${pred.locationText}" ⊅ "${exp.locationContains}"`); }
    }

    const ok = missed.length === 0 && spurious.length === 0 && caseFieldErrors.length === 0;
    const countNote = missed.length || spurious.length
      ? ` [count: exp ${c.expected.length}, got ${preds.length}; missed ${missed.length}, spurious ${spurious.length}]`
      : "";
    console.log(`${ok ? "✓" : "•"} ${c.id}${countNote}`);
    for (const err of caseFieldErrors) console.log(`    ${err}`);
  }

  // ── Report ──────────────────────────────────────────────────────────────
  console.log(`${"─".repeat(64)}\nField accuracy (over ${matchedPairs} matched properties):`);
  for (const f of SCORED_FIELDS) {
    const pct = fieldTotal[f] ? (100 * fieldHits[f]) / fieldTotal[f] : 0;
    console.log(`  ${f.padEnd(12)} ${pct.toFixed(0).padStart(3)}%  (${fieldHits[f]}/${fieldTotal[f]})`);
  }
  if (locTotal) console.log(`  ${"location".padEnd(12)} ${((100 * locHits) / locTotal).toFixed(0).padStart(3)}%  (${locHits}/${locTotal})`);

  const recall = totalExpected ? matchedPairs / totalExpected : 1;
  const precision = matchedPairs + totalSpurious ? matchedPairs / (matchedPairs + totalSpurious) : 1;
  console.log(`\nProperty detection:`);
  console.log(`  precision ${(100 * precision).toFixed(0)}%  recall ${(100 * recall).toFixed(0)}%`);
  console.log(`  missed ${totalMissed}, spurious (hallucinated) ${totalSpurious}`);
  if (failures) console.log(`\n⚠️  ${failures} case(s) errored during extraction.`);
  console.log("");
}

function fmt2(v: unknown): string {
  if (typeof v === "number") return v.toLocaleString("en-US");
  return String(v);
}

run().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

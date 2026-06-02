/**
 * Robust summary stats (median + IQR), computed in JS. The dataset is small in
 * Phase 1; move percentiles into SQL (percentile_cont) when volume grows.
 * Design §7: prefer median/IQR over mean±stddev for heavy-tailed, noisy prices.
 */

/** Linear-interpolated quantile (q in [0,1]) over a numeric array. */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface Distribution {
  n: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
}

export function distribution(values: number[]): Distribution {
  const clean = values.filter((v) => Number.isFinite(v));
  return {
    n: clean.length,
    median: quantile(clean, 0.5),
    p25: quantile(clean, 0.25),
    p75: quantile(clean, 0.75),
    min: clean.length ? Math.min(...clean) : null,
    max: clean.length ? Math.max(...clean) : null,
  };
}

// Below this count a distribution is statistically meaningless — suppress/caveat it (§7).
export const MIN_SAMPLE = 5;

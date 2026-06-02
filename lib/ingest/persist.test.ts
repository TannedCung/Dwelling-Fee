import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePricePerM2 } from "./persist";

test("derivePricePerM2: per_m2 basis passes the price through unchanged", () => {
  assert.equal(derivePricePerM2(80_000_000, 75, "per_m2"), "80000000");
  // area is irrelevant when the price is already per-m²
  assert.equal(derivePricePerM2(80_000_000, null, "per_m2"), "80000000");
});

test("derivePricePerM2: total basis divides by area and rounds", () => {
  assert.equal(derivePricePerM2(4_500_000_000, 75, "total"), "60000000");
  assert.equal(derivePricePerM2(1_000_000_000, 30, "total"), "33333333");
});

test("derivePricePerM2: total basis without a usable area is null", () => {
  assert.equal(derivePricePerM2(4_500_000_000, null, "total"), null);
  assert.equal(derivePricePerM2(4_500_000_000, 0, "total"), null);
});

test("derivePricePerM2: null price is always null", () => {
  assert.equal(derivePricePerM2(null, 75, "total"), null);
  assert.equal(derivePricePerM2(null, 75, "per_m2"), null);
});

test("derivePricePerM2: unknown basis is null", () => {
  assert.equal(derivePricePerM2(4_500_000_000, 75, "unknown"), null);
});

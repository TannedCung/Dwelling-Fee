import { test } from "node:test";
import assert from "node:assert/strict";
import { quantile, distribution, MIN_SAMPLE } from "./stats";

test("quantile: empty input is null", () => {
  assert.equal(quantile([], 0.5), null);
});

test("quantile: single value returns that value for any q", () => {
  assert.equal(quantile([42], 0), 42);
  assert.equal(quantile([42], 0.5), 42);
  assert.equal(quantile([42], 1), 42);
});

test("quantile: linear interpolation between points", () => {
  const v = [1, 2, 3, 4];
  assert.equal(quantile(v, 0.5), 2.5);
  assert.equal(quantile(v, 0.25), 1.75);
  assert.equal(quantile(v, 0.75), 3.25);
});

test("quantile: input is not mutated (sort is on a copy)", () => {
  const v = [3, 1, 2];
  quantile(v, 0.5);
  assert.deepEqual(v, [3, 1, 2]);
});

test("distribution: reports n/median/IQR/min/max", () => {
  const d = distribution([10, 20, 30, 40, 50]);
  assert.equal(d.n, 5);
  assert.equal(d.median, 30);
  assert.equal(d.p25, 20);
  assert.equal(d.p75, 40);
  assert.equal(d.min, 10);
  assert.equal(d.max, 50);
});

test("distribution: drops non-finite values before computing", () => {
  const d = distribution([1, 2, NaN, Infinity, -Infinity, 3]);
  assert.equal(d.n, 3);
  assert.equal(d.median, 2);
});

test("distribution: empty yields nulls, n=0", () => {
  const d = distribution([]);
  assert.deepEqual(d, { n: 0, median: null, p25: null, p75: null, min: null, max: null });
});

test("MIN_SAMPLE floor is 5 (design §7 sample guard)", () => {
  assert.equal(MIN_SAMPLE, 5);
});

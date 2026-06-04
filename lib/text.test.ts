import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, tokens, jaccard } from "./text";

test("normalizeName: strips Vietnamese diacritics and lowercases", () => {
  assert.equal(normalizeName("Alpha Quận 9"), "alpha quan 9");
  assert.equal(normalizeName("Tòa S1.05"), "toa s1 05");
});

test("normalizeName: đ/Đ maps to d", () => {
  assert.equal(normalizeName("Đảo Kim Cương"), "dao kim cuong");
});

test("normalizeName: collapses punctuation and whitespace", () => {
  assert.equal(normalizeName("  Alpha — Block   A!! "), "alpha block a");
});

test("tokens: keeps tokens of length >= 3", () => {
  assert.deepEqual(tokens("vinhomes q9 toa s1 9"), ["vinhomes", "toa"]);
});

test("jaccard: identical token sets is 1", () => {
  assert.equal(jaccard(["vinhomes", "grand"], ["grand", "vinhomes"]), 1);
});

test("jaccard: disjoint sets is 0", () => {
  assert.equal(jaccard(["alpha"], ["beta"]), 0);
});

test("jaccard: empty input is 0", () => {
  assert.equal(jaccard([], ["x"]), 0);
});

test("jaccard: partial overlap = inter / union", () => {
  // intersection {b} = 1, union {a,b,c} = 3
  assert.equal(jaccard(["a", "b"], ["b", "c"]), 1 / 3);
});

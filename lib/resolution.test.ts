import { test } from "node:test";
import assert from "node:assert/strict";
import { score } from "./resolution";
import type { PropertyExtraction } from "./extraction/schema";

function ex(over: Partial<PropertyExtraction> = {}): PropertyExtraction {
  const base: PropertyExtraction = {
    name: "Vinhomes Grand Park",
    projectName: null,
    buildingName: null,
    houseNumber: null,
    aliases: [],
    tags: [],
    type: "apartment",
    listingType: "sale",
    priceVnd: 4_500_000_000,
    priceBasis: "total",
    areaM2: 75,
    bedrooms: 2,
    isNegotiable: false,
    dealStatus: "asking",
    locationText: "Quận 9",
    confidence: 0.9,
  };
  return { ...base, ...over };
}

test("score: identical legacy name + type + area band clears auto-link territory", () => {
  const s = score(ex(), { name: "Vinhomes Grand Park", type: "apartment", attributes: { areaM2: 75 } });
  assert.equal(s, 0.9199999999999999); // 0.72 legacy name + 0.1 type + 0.1 area
});

test("score: a different name scores low (below review band)", () => {
  const s = score(ex(), { name: "Masteri Thao Dien", type: "apartment", attributes: { areaM2: 75 } });
  // name jaccard 0; only type(0.1)+area(0.1) contribute
  assert.ok(s < 0.45, `expected < 0.45, got ${s}`);
});

test("score: type mismatch removes the type weight", () => {
  const s = score(ex(), { name: "Vinhomes Grand Park", type: "house", attributes: { areaM2: 75 } });
  assert.equal(s, 0.82); // 0.72 legacy name + 0 type + 0.1 area
});

test("score: area outside 10% band does not count", () => {
  const s = score(ex(), { name: "Vinhomes Grand Park", type: "apartment", attributes: { areaM2: 100 } });
  assert.equal(s, 0.82); // 0.72 legacy name + 0.1 type + 0 area
});

test("score: missing candidate name yields name similarity 0", () => {
  const s = score(ex(), { name: null, type: "apartment", attributes: null });
  assert.equal(s, 0.1); // only type matches
});

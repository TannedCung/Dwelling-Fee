import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanProjectName, displayName, score } from "./resolution";
import type { PropertyExtraction } from "./extraction/schema";

function ex(over: Partial<PropertyExtraction> = {}): PropertyExtraction {
  const base: PropertyExtraction = {
    name: "Alpha Residence",
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
  const s = score(ex(), { name: "Alpha Residence", type: "apartment", attributes: { areaM2: 75 } });
  assert.equal(s, 0.9199999999999999); // 0.72 legacy name + 0.1 type + 0.1 area
});

test("score: a different name scores low (below review band)", () => {
  const s = score(ex(), { name: "Beta Residence", type: "apartment", attributes: { areaM2: 75 } });
  // name jaccard 0; only type(0.1)+area(0.1) contribute
  assert.ok(s < 0.45, `expected < 0.45, got ${s}`);
});

test("score: type mismatch removes the type weight", () => {
  const s = score(ex(), { name: "Alpha Residence", type: "house", attributes: { areaM2: 75 } });
  assert.equal(s, 0.82); // 0.72 legacy name + 0 type + 0.1 area
});

test("score: area outside 10% band does not count", () => {
  const s = score(ex(), { name: "Alpha Residence", type: "apartment", attributes: { areaM2: 100 } });
  assert.equal(s, 0.82); // 0.72 legacy name + 0.1 type + 0 area
});

test("score: missing candidate name yields name similarity 0", () => {
  const s = score(ex(), { name: null, type: "apartment", attributes: null });
  assert.equal(s, 0.1); // only type matches
});

test("cleanProjectName: moves category prefixes out of canonical identity", () => {
  assert.equal(cleanProjectName("nhà phố ABC"), "ABC");
  assert.equal(cleanProjectName("ABC"), "ABC");
});

test("displayName: uses project -> building -> house hierarchy", () => {
  assert.equal(
    displayName(ex({ projectName: "ABC", buildingName: "Block A", houseNumber: "Căn 1", name: "nhà phố ABC" })),
    "ABC / Block A / Căn 1",
  );
});

test("score: prefixed project alias matches canonical project hierarchy", () => {
  const s = score(
    ex({ name: "nhà phố ABC", projectName: "nhà phố ABC", houseNumber: "Căn 1", type: "house" }),
    { name: "ABC / Căn 1", projectName: "ABC", houseNumber: "Căn 1", type: "house", attributes: { areaM2: 75 } },
  );
  assert.ok(s >= 0.8, `expected auto-link score, got ${s}`);
});

test("score: grounded aliases let tower/unit observations link to a parent project", () => {
  const s = score(
    ex({
      name: "Project Alpha East Tower Unit 1201",
      projectName: "Project Alpha East",
      buildingName: "East Tower",
      houseNumber: "Unit 1201",
      locationText: "Project Alpha District",
    }),
    {
      name: "Project Alpha",
      projectName: "Project Alpha",
      buildingName: null,
      houseNumber: null,
      aliases: ["Project Alpha East", "Project Alpha West"],
      wikiNotes: "Project Alpha has East and West phases; towers and unit numbers are observation-level details.",
      type: "apartment",
      attributes: null,
    },
  );
  assert.ok(s >= 0.8, `expected grounded parent-project auto-link score, got ${s}`);
});

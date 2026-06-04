import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanProjectName, displayName, resolutionIdentity, score } from "./resolution";
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

test("resolutionIdentity: Lumi subzone/tower/unit observations resolve to the parent project", () => {
  const identity = resolutionIdentity(ex({
    name: "Lumi Signature Tòa Elite Căn 4",
    projectName: "Lumi Signature",
    buildingName: "Tòa Elite",
    houseNumber: "Căn 4",
    locationText: "Lumi Hanoi CapitalLand",
    aliases: ["Lumi Elite"],
    tags: ["apartment"],
  }));

  assert.equal(identity.name, "Lumi");
  assert.equal(identity.projectName, "Lumi");
  assert.equal(identity.buildingName, null);
  assert.equal(identity.houseNumber, null);
  assert.ok(identity.aliases.includes("Lumi Signature"));
  assert.ok(identity.tags.includes("signature"));
});

test("score: different Lumi buildings and units clear auto-link against the parent project", () => {
  const identity = resolutionIdentity(ex({
    name: "Lumi Signature Tòa S3 Căn 1",
    projectName: "Lumi Signature",
    buildingName: "Tòa S3",
    houseNumber: "Căn 1",
    locationText: "Lumi Hanoi CapitalLand",
  }));
  const s = score(identity, { name: "Lumi", projectName: "Lumi", type: "apartment", attributes: null });
  assert.ok(s >= 0.8, `expected parent-project auto-link score, got ${s}`);
});

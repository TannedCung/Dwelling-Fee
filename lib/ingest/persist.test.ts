import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePricePerM2, hasSpecificPropertyIdentity, requiresGroundedParent, shouldReviewExtraction } from "./persist";
import type { PropertyExtraction } from "../extraction/schema";

function ex(over: Partial<PropertyExtraction> = {}): PropertyExtraction {
  return {
    name: "Project Alpha",
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
    locationText: null,
    confidence: 0.9,
    ...over,
  };
}

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

test("shouldReviewExtraction: identity-less extracts are quarantined even with high confidence", () => {
  assert.equal(shouldReviewExtraction(ex({ name: null, projectName: null, locationText: null })), true);
  assert.equal(shouldReviewExtraction(ex({ type: "house", name: null, projectName: "Project Alpha", locationText: null })), false);
});

test("requiresGroundedParent: apartment tower/unit observations need grounded parent before creation", () => {
  assert.equal(hasSpecificPropertyIdentity(ex({ projectName: "Project Alpha", buildingName: "Tower A", houseNumber: "Unit 1" })), true);
  assert.equal(hasSpecificPropertyIdentity(ex({ projectName: "Project Alpha", buildingName: null, houseNumber: null })), false);
  assert.equal(hasSpecificPropertyIdentity(ex({ type: "house", projectName: "Project Alpha", houseNumber: "LK-1" })), true);
});

test("shouldReviewExtraction: apartment project/building signals need a specific unit identity", () => {
  assert.equal(shouldReviewExtraction(ex({ projectName: "Project Alpha", buildingName: null, houseNumber: null })), true);
  assert.equal(shouldReviewExtraction(ex({ projectName: "Project Alpha", buildingName: "Tower A", houseNumber: null })), true);
});

test("requiresGroundedParent: checks project/building existence before auto-create", async () => {
  const calls: string[] = [];
  const db = {
    query: {
      project: {
        findFirst: async () => {
          calls.push("project");
          return null;
        },
      },
    },
  } as never;
  assert.equal(await requiresGroundedParent(ex({ projectName: "Project Alpha", buildingName: "Tower A", houseNumber: "Unit 1" }), db), true);
  assert.deepEqual(calls, ["project"]);
});

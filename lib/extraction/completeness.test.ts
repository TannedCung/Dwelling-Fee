import { test } from "node:test";
import assert from "node:assert/strict";
import { isComplete, draftReady, missingFields } from "./completeness";
import type { PropertyExtraction } from "./schema";

function ex(over: Partial<PropertyExtraction> = {}): PropertyExtraction {
  const base: PropertyExtraction = {
    name: "Lumi Hanoi",
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
  };
  return { ...base, ...over };
}

test("isComplete: a property with all required fields is complete", () => {
  assert.equal(isComplete(ex()), true);
  assert.deepEqual(missingFields(ex()), []);
});

test("missingFields: reports each absent required field", () => {
  assert.deepEqual(missingFields(ex({ priceVnd: null })), ["price"]);
  assert.deepEqual(missingFields(ex({ priceBasis: "unknown" })), ["price basis (total or per m²)"]);
  assert.deepEqual(missingFields(ex({ listingType: "unknown" })), ["listing type (sale or rent)"]);
  assert.deepEqual(missingFields(ex({ areaM2: null })), ["area (m²)"]);
});

test("identity: name OR location satisfies the identity requirement", () => {
  assert.equal(isComplete(ex({ name: null, locationText: "Quận 9" })), true);
  assert.deepEqual(missingFields(ex({ name: null, locationText: null })), ["project/property identity or location"]);
});

test("dealStatus and type are NOT required (don't block commit)", () => {
  assert.equal(isComplete(ex({ dealStatus: "unknown", type: "unknown" })), true);
});

test("draftReady: false when empty, true only when every property is complete", () => {
  assert.equal(draftReady([]), false);
  assert.equal(draftReady([ex()]), true);
  assert.equal(draftReady([ex(), ex({ priceVnd: null })]), false);
});

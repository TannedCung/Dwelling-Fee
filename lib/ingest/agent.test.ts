import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDraftTurnCandidate } from "./agent";
import { PropertyExtraction } from "../extraction/schema";

test("normalizeDraftTurnCandidate fills absent nullable/defaultable property fields", () => {
  const normalized = normalizeDraftTurnCandidate({
    reply: "ok",
    readyToCommit: true,
    properties: [{
      projectName: "Ecopark",
      buildingName: "Park Premium",
      areaM2: 58,
      bedrooms: 2,
      listingType: "sale",
      priceVnd: 3_600_000_000,
      priceBasis: "total",
      isNegotiable: false,
      dealStatus: "asking",
      confidence: 0.9,
    }],
    projectCuration: [],
  });

  assert.equal(typeof normalized, "object");
  const property = (normalized as { properties: unknown[] }).properties[0];
  const parsed = PropertyExtraction.parse(property);
  assert.equal(parsed.name, null);
  assert.equal(parsed.houseNumber, null);
  assert.deepEqual(parsed.aliases, []);
  assert.deepEqual(parsed.tags, []);
});

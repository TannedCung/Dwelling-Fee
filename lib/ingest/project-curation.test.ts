import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTier2Attributes, mergeTier2WikiNotes } from "./project-curation";

test("mergeTier2Attributes dedupes repeated project evidence records", () => {
  const record = {
    tier: "tier_2_unconfirmed",
    projectName: "Ecopark",
    buildingName: "Park Premium",
    appliesTo: "project",
    evidence: [{ url: "https://example.test/ecopark", title: "Ecopark" }],
  };

  const once = mergeTier2Attributes(null, record);
  const twice = mergeTier2Attributes(once, record);

  assert.equal(Array.isArray(twice.tier2Research), true);
  assert.equal((twice.tier2Research as unknown[]).length, 1);
});

test("mergeTier2WikiNotes marks curated notes as unconfirmed and avoids duplicates", () => {
  const once = mergeTier2WikiNotes(null, "Park Premium là tòa căn hộ trong Ecopark.");
  const twice = mergeTier2WikiNotes(once, "Park Premium là tòa căn hộ trong Ecopark.");

  assert.equal(once, "[Tier 2 unconfirmed] Park Premium là tòa căn hộ trong Ecopark.");
  assert.equal(twice, once);
});

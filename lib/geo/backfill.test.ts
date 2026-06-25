import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGeocodeCandidates, buildGeocodeQuery } from "./backfill";

test("buildGeocodeQuery expands HCMC District 9 shorthand", () => {
  const query = buildGeocodeQuery("Vinhomes Grand Park Q9", "District 9");

  assert.match(query, /Thành phố Thủ Đức/);
  assert.match(query, /Thành phố Hồ Chí Minh/);
  assert.doesNotMatch(query, /\bQ9\b|District 9/);
});

test("buildGeocodeQuery normalizes hierarchy separators for providers", () => {
  assert.equal(buildGeocodeQuery("Ecopark / Park Premium", null), "Ecopark Park Premium, Vietnam");
});

test("buildGeocodeCandidates falls back from building marketing names to parent project", () => {
  const queries = buildGeocodeCandidates({
    name: "Khu đô thị Ecopark / Sky Forest Residences",
    projectName: "Khu đô thị Ecopark",
    buildingName: "Sky Forest Residences",
    houseNumber: null,
    addressText: "X. Xuân Quan (X. Phụng Công mới)",
    projectAddressText: "X. Xuân Quan (X. Phụng Công mới)",
    buildingAddressText: null,
    observationLocationTexts: [],
  }).map((candidate) => candidate.query);

  assert.ok(queries.includes("Sky Forest Residences Ecopark, X. Xuân Quan (X. Phụng Công mới), Vietnam"));
  assert.ok(queries.includes("Ecopark, Vietnam"));
});

test("buildGeocodeCandidates uses observation locations when entity address is missing", () => {
  const candidates = buildGeocodeCandidates({
    name: "Ecopark / Park Premium",
    projectName: "Ecopark",
    buildingName: "Park Premium",
    houseNumber: null,
    addressText: null,
    projectAddressText: null,
    buildingAddressText: null,
    observationLocationTexts: [
      "X. Xuân Quan (X. Phụng Công mới)",
      "X. Xuân Quan (X. Phụng Công mới), Ecopark, Hưng Yên",
    ],
  });

  assert.deepEqual(candidates[0], {
    query: "Ecopark Park Premium, X. Xuân Quan (X. Phụng Công mới), Ecopark, Hưng Yên, Vietnam",
    addressText: "X. Xuân Quan (X. Phụng Công mới), Ecopark, Hưng Yên",
  });
  assert.ok(candidates.some((candidate) => candidate.query === "Ecopark, Vietnam"));
});

test("buildGeocodeCandidates includes reversed building and project name fallback", () => {
  const queries = buildGeocodeCandidates({
    name: "Khu đô thị Ecopark / S-PREMIUM",
    projectName: "Khu đô thị Ecopark",
    buildingName: "S-PREMIUM",
    houseNumber: null,
    addressText: "X. Xuân Quan (X. Phụng Công mới), Văn Giang, Hưng Yên",
    projectAddressText: null,
    buildingAddressText: null,
    observationLocationTexts: [],
  }).map((candidate) => candidate.query);

  assert.ok(queries.includes("S-PREMIUM Ecopark, Vietnam"));
});

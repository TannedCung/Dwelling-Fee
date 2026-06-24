import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGeocodeQuery } from "./backfill";

test("buildGeocodeQuery expands HCMC District 9 shorthand", () => {
  const query = buildGeocodeQuery("Vinhomes Grand Park Q9", "District 9");

  assert.match(query, /Thành phố Thủ Đức/);
  assert.match(query, /Thành phố Hồ Chí Minh/);
  assert.doesNotMatch(query, /\bQ9\b|District 9/);
});

test("buildGeocodeQuery normalizes hierarchy separators for providers", () => {
  assert.equal(buildGeocodeQuery("Ecopark / Park Premium", null), "Ecopark Park Premium, Vietnam");
});

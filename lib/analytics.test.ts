import { test } from "node:test";
import assert from "node:assert/strict";
import { monthAxis, monthKey, monthlyTrend, rankByArea, histogramBins, areaLabel, parseFilters } from "./analytics";
import { MIN_SAMPLE } from "./stats";

const M = 1_000_000;

function obs(partial: Partial<Parameters<typeof monthlyTrend>[0][number]>) {
  return {
    ppm2: null,
    listingType: "sale",
    dealStatus: "asking",
    propertyType: "apartment",
    projectName: null,
    buildingName: null,
    area: null,
    at: new Date("2026-06-15T00:00:00Z"),
    ...partial,
  };
}

test("monthAxis: returns `period` consecutive months ending at now (oldest first)", () => {
  const axis = monthAxis(3, new Date("2026-06-15T00:00:00Z"));
  assert.equal(axis.length, 3);
  assert.deepEqual(
    axis.map((a) => a.key),
    ["2026-04", "2026-05", "2026-06"],
  );
  assert.equal(axis[2]!.label, "T6");
});

test("monthKey: zero-pads the month", () => {
  assert.equal(monthKey(new Date("2026-01-09T00:00:00Z")), "2026-01");
});

test("monthlyTrend: medians asking/transacted separately and counts volume", () => {
  const axis = monthAxis(3, new Date("2026-06-15T00:00:00Z"));
  const rows = [
    obs({ at: new Date("2026-06-02T00:00:00Z"), dealStatus: "asking", ppm2: 50 * M }),
    obs({ at: new Date("2026-06-20T00:00:00Z"), dealStatus: "asking", ppm2: 60 * M }),
    obs({ at: new Date("2026-06-21T00:00:00Z"), dealStatus: "transacted", ppm2: 48 * M }),
    obs({ at: new Date("2026-05-10T00:00:00Z"), dealStatus: "asking", ppm2: 40 * M }),
  ];
  const trend = monthlyTrend(rows, axis);
  const may = trend.find((p) => p.key === "2026-05")!;
  const jun = trend.find((p) => p.key === "2026-06")!;
  assert.equal(may.asking, 40 * M);
  assert.equal(may.transacted, null);
  assert.equal(may.volume, 1);
  assert.equal(jun.asking, 55 * M); // median of 50,60
  assert.equal(jun.transacted, 48 * M);
  assert.equal(jun.volume, 3);
});

test("rankByArea: sorts by median desc and dims small samples", () => {
  const rows = [
    ...Array.from({ length: MIN_SAMPLE }, () => obs({ area: "Q2", ppm2: 80 * M })),
    obs({ area: "Q7", ppm2: 90 * M }), // n=1 → dim
    obs({ area: null, ppm2: 100 * M }), // no area → excluded
  ];
  const ranked = rankByArea(rows);
  assert.deepEqual(ranked.map((r) => r.label), ["Q7", "Q2"]);
  assert.equal(ranked[0]!.dim, true);
  assert.equal(ranked[1]!.dim, false);
  assert.equal(ranked[1]!.n, MIN_SAMPLE);
});

test("histogramBins: null below MIN_SAMPLE, bins cover the range otherwise", () => {
  assert.equal(histogramBins([1 * M, 2 * M]), null);
  const vals = [30 * M, 35 * M, 40 * M, 55 * M, 60 * M, 80 * M];
  const h = histogramBins(vals)!;
  assert.ok(h);
  assert.equal(
    h.bins.reduce((a, b) => a + b, 0),
    vals.length,
  );
  assert.ok(h.lo <= 30 * M);
  assert.ok(h.step >= M);
});

test("areaLabel: prefers location name, else a district token from the address", () => {
  assert.equal(areaLabel("Thảo Điền", "ignored"), "Thảo Điền");
  assert.equal(areaLabel(null, "123 Nguyễn Huệ, Bến Nghé, Quận 1, TP.HCM"), "Quận 1");
  assert.equal(areaLabel(null, "Quận 7"), "Quận 7");
  assert.equal(areaLabel(null, null), null);
});

test("parseFilters: validates deal and period, defaults otherwise", () => {
  assert.deepEqual(parseFilters({}), { type: "all", project: "all", building: "all", deal: "all", period: 12 });
  assert.deepEqual(parseFilters({ type: "apartment", deal: "asking", period: "6", project: "Vinhomes" }), {
    type: "apartment",
    project: "Vinhomes",
    building: "all",
    deal: "asking",
    period: 6,
  });
  assert.equal(parseFilters({ deal: "bogus", period: "99" }).deal, "all");
  assert.equal(parseFilters({ period: "99" }).period, 12);
});

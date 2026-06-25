import { test } from "node:test";
import assert from "node:assert/strict";
import { postProcessProjectBuildingAssignments } from "./hierarchy-assignment";
import type { InternetSearchOutput } from "../collection/internet-search";
import { INTERNET_SEARCH_CAVEAT, INTERNET_SEARCH_EVIDENCE_LABEL, INTERNET_SEARCH_EVIDENCE_TIER } from "../collection/internet-search";
import type { PropertyExtraction } from "../extraction/schema";
import type { DbGroundingMatch } from "./research";

function ex(over: Partial<PropertyExtraction> = {}): PropertyExtraction {
  return {
    name: "Khu đô thị Ecopark / Sky Forest",
    projectName: "Khu đô thị Ecopark",
    buildingName: "Sky Forest",
    houseNumber: "A1201",
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
    locationText: "Văn Giang, Hưng Yên",
    confidence: 0.9,
    ...over,
  };
}

test("postProcessProjectBuildingAssignments prefers existing DB project/building names", async () => {
  let internetCalled = false;
  const result = await postProcessProjectBuildingAssignments([ex()], {} as never, {
    searchDb: async (): Promise<DbGroundingMatch[]> => [
      {
        entityType: "project",
        id: "p1",
        name: "Ecopark",
        projectName: "Ecopark",
        buildingName: null,
        addressText: "Văn Giang, Hưng Yên",
        wikiNotes: null,
      },
      {
        entityType: "building",
        id: "b1",
        name: "Sky Forest Residences",
        projectName: "Ecopark",
        buildingName: "Sky Forest Residences",
        addressText: "Văn Giang, Hưng Yên",
        wikiNotes: null,
      },
    ],
    searchInternet: async () => {
      internetCalled = true;
      return internetOutput([]);
    },
  });

  assert.equal(internetCalled, false);
  assert.equal(result.properties[0]?.projectName, "Ecopark");
  assert.equal(result.properties[0]?.buildingName, "Sky Forest Residences");
  assert.equal(result.properties[0]?.name, "Ecopark / Sky Forest Residences / A1201");
  assert.deepEqual(result.projectCuration, []);
});

test("postProcessProjectBuildingAssignments uses internet only to confirm a new unique hierarchy", async () => {
  const result = await postProcessProjectBuildingAssignments([
    ex({
      name: "Lumi Hanoi / Tower A",
      projectName: "Lumi Hanoi",
      buildingName: "Tower A",
      locationText: "Tây Mỗ, Hà Nội",
    }),
  ], {} as never, {
    searchDb: async () => [],
    searchInternet: async () => internetOutput([
      {
        title: "Lumi Hanoi project information",
        url: "https://example.com/lumi-hanoi",
        snippet: "Lumi Hanoi is a residential project in Tay Mo with Tower A information.",
      },
      {
        title: "Lumi Hanoi Tower A overview",
        url: "https://example.vn/lumi-hanoi-tower-a",
        snippet: "Project Lumi Hanoi includes Tower A and other towers.",
      },
    ]),
  });

  assert.equal(result.properties[0]?.projectName, "Lumi Hanoi");
  assert.equal(result.properties[0]?.buildingName, "Tower A");
  assert.equal(result.projectCuration.length, 1);
  assert.equal(result.projectCuration[0]?.projectName, "Lumi Hanoi");
  assert.equal(result.projectCuration[0]?.buildingName, "Tower A");
  assert.equal(result.projectCuration[0]?.evidence.length, 2);
});

test("postProcessProjectBuildingAssignments does not assign unsupported or unreasonable names", async () => {
  const result = await postProcessProjectBuildingAssignments([
    ex({
      name: null,
      projectName: "Cần bán căn hộ 2PN giá tốt",
      buildingName: null,
      houseNumber: "A1201",
    }),
  ], {} as never, {
    searchDb: async () => {
      throw new Error("DB search should not run for unreasonable hierarchy names");
    },
    searchInternet: async () => {
      throw new Error("internet search should not run for unreasonable hierarchy names");
    },
  });

  assert.equal(result.properties[0]?.projectName, "Cần bán căn hộ 2PN giá tốt");
  assert.equal(result.properties[0]?.buildingName, null);
  assert.deepEqual(result.projectCuration, []);
});

function internetOutput(results: Array<{ title: string; url: string; snippet: string }>): InternetSearchOutput {
  return {
    query: "test query",
    purpose: "test",
    retrievedAt: "2026-06-25T00:00:00.000Z",
    provider: "brave",
    tier: INTERNET_SEARCH_EVIDENCE_TIER,
    tierLabel: INTERNET_SEARCH_EVIDENCE_LABEL,
    caveat: INTERNET_SEARCH_CAVEAT,
    warnings: [],
    results: results.map((result) => ({
      ...result,
      source: new URL(result.url).hostname,
      publishedAt: null,
      tier: INTERNET_SEARCH_EVIDENCE_TIER,
      tierLabel: INTERNET_SEARCH_EVIDENCE_LABEL,
      caveat: INTERNET_SEARCH_CAVEAT,
    })),
  };
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCreateSuggestion } from "./review";
import type { PropertyExtraction } from "./extraction/schema";

function ex(over: Partial<PropertyExtraction> = {}): PropertyExtraction {
  return {
    name: "Khu đô thị Ecopark",
    projectName: "Khu đô thị Ecopark",
    buildingName: null,
    houseNumber: null,
    aliases: [],
    tags: ["sân vườn"],
    type: "apartment",
    listingType: "sale",
    priceVnd: 9_600_000_000,
    priceBasis: "total",
    areaM2: 121,
    bedrooms: 3,
    isNegotiable: false,
    dealStatus: "asking",
    locationText: "X. Xuân Quan",
    confidence: 0.95,
    ...over,
  };
}

test("buildCreateSuggestion uses extracted project/building hierarchy", () => {
  const suggestion = buildCreateSuggestion(ex({ buildingName: "Park Premium", houseNumber: "A1201" }));

  assert.equal(suggestion.projectName, "Khu đô thị Ecopark");
  assert.equal(suggestion.buildingName, "Park Premium");
  assert.equal(suggestion.houseNumber, "A1201");
  assert.equal(suggestion.label, "Khu đô thị Ecopark / Park Premium / A1201");
});

test("buildCreateSuggestion infers sub-development from web listing URL slug", () => {
  const suggestion = buildCreateSuggestion(
    ex(),
    "Title: Căn hộ sân vườn giá tốt nhất dự án tìm chủ nhân mới",
    "https://batdongsan.com.vn/ban-can-ho-chung-cu-xa-xuan-quan-sky-forest-residences-ecopark/san-vuon-gia-tot-nhat-pr455955622",
  );

  assert.equal(suggestion.projectName, "Khu đô thị Ecopark");
  assert.equal(suggestion.buildingName, "Sky Forest Residences");
  assert.equal(suggestion.label, "Khu đô thị Ecopark / Sky Forest Residences");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDistilledEdgePost } from "./distill";

test("formatDistilledEdgePost keeps extraction facts compact and source-backed", () => {
  const text = formatDistilledEdgePost({
    title: "Bán căn hộ Ecopark 2PN",
    listingType: "sale",
    propertyType: "apartment",
    projectName: "Ecopark",
    buildingName: "Sky Oasis",
    houseNumber: null,
    locationText: "Văn Giang, Hưng Yên",
    priceText: "3.6 tỷ, thương lượng",
    areaText: "58 m²",
    bedroomsText: "2PN",
    legalText: "Sổ hồng",
    layoutText: "Full nội thất",
    statusText: "Đang bán",
    usefulFacts: ["Ban công Đông Nam", "Tầng cao"],
    confidence: 0.87,
  }, {
    sourceRef: "https://batdongsan.com.vn/ban-can-ho/ecopark-a",
    pageUrl: "https://batdongsan.com.vn/ban-can-ho-chung-cu-khu-do-thi-ecopark",
  });

  assert.match(text, /Source URL: https:\/\/batdongsan\.com\.vn\/ban-can-ho\/ecopark-a/);
  assert.match(text, /Project: Ecopark/);
  assert.match(text, /Price: 3\.6 tỷ, thương lượng/);
  assert.match(text, /- Ban công Đông Nam/);
  assert.doesNotMatch(text, /null|undefined/);
});

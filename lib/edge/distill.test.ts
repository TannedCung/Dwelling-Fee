import assert from "node:assert/strict";
import { test } from "node:test";
import { distillEdgePost, formatDistilledEdgePost } from "./distill";

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

test("MOCK_AI distillation keeps compact listing facts instead of raw page text", async () => {
  const previous = process.env.MOCK_AI;
  process.env.MOCK_AI = "1";
  try {
    const raw = [
      "Đăng nhập",
      "Lưu tin",
      "Chia sẻ",
      "Bán căn hộ Ecopark Sky Oasis 2PN, diện tích 58m².",
      "Giá 3.6 tỷ, thương lượng.",
      "Sổ hồng, full nội thất, ban công Đông Nam.",
      "Liên hệ Zalo 0900 000 000 gặp Anh A.",
      "Tin liên quan Tin liên quan Tin liên quan Tin liên quan",
    ].join("\n");

    const text = await distillEdgePost({
      rawText: raw,
      sourceRef: "https://batdongsan.com.vn/ban-can-ho/ecopark-a",
      pageUrl: "https://batdongsan.com.vn/ban-can-ho-chung-cu-khu-do-thi-ecopark",
    });

    assert.match(text, /Source URL: https:\/\/batdongsan\.com\.vn\/ban-can-ho\/ecopark-a/);
    assert.match(text, /Bán căn hộ Ecopark Sky Oasis 2PN/);
    assert.match(text, /Giá 3\.6 tỷ/);
    assert.match(text, /Sổ hồng/);
    assert.doesNotMatch(text, /Raw listing excerpt/);
    assert.doesNotMatch(text, /0900 000 000/);
    assert.doesNotMatch(text, /Đăng nhập|Lưu tin|Chia sẻ/);
    assert.ok(text.length < 700);
  } finally {
    if (previous === undefined) delete process.env.MOCK_AI;
    else process.env.MOCK_AI = previous;
  }
});

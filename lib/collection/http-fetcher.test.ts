import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, extractPageItems, extractLinks, visibleText } from "./http-fetcher";

test("visibleText strips hidden content, decodes entities, and keeps readable lines", () => {
  const html = `
    <html>
      <head><title>ignore me</title></head>
      <body>
        <script>window.secret = "no";</script>
        <style>.x { display: none; }</style>
        <h1>Căn hộ &amp; nhà phố</h1>
        <p>Giá 5.2 tỷ&nbsp;TL</p>
        <div>Diện tích <strong>72m²</strong></div>
      </body>
    </html>
  `;

  assert.equal(visibleText(html), "Căn hộ & nhà phố\nGiá 5.2 tỷ TL\nDiện tích 72m²");
});

test("extractLinks resolves and canonicalizes HTTP links", () => {
  const links = extractLinks(
    `
      <a href="/listing/a?b=2&a=1#photos">A</a>
      <a href="https://example.com/listing/a?a=1&b=2">duplicate</a>
      <a href="tel:0900000000">phone</a>
      <a href="javascript:void(0)">bad</a>
    `,
    new URL("https://example.com/search"),
  );

  assert.deepEqual(links.map((url) => url.href), ["https://example.com/listing/a?a=1&b=2"]);
});

test("extractPageItems splits listing cards with selectors", () => {
  const result = extractPageItems(
    `
      <html><head><title>Listings</title></head><body>
        <article class="listing"><a href="/a">A</a><p>Bán căn hộ A giá 5 tỷ</p></article>
        <article class="listing"><a href="/b">B</a><p>Bán căn hộ B giá 6 tỷ</p></article>
      </body></html>
    `,
    new URL("https://example.com/search"),
    { itemSelector: ".listing" },
    new Date("2026-06-03T00:00:00.000Z"),
  );

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.sourceRef, "https://example.com/a");
  assert.equal(result.items[1]?.sourceRef, "https://example.com/b");
  assert.match(result.items[0]?.text ?? "", /Bán căn hộ A giá 5 tỷ/);
});

test("extractPageItems promotes selected listing links to their card text and URL", () => {
  const result = extractPageItems(
    `
      <html><head><title>Listings</title></head><body>
        <div class="re__card-info">
          <a class="js__product-link-for-product-id" href="/ban-can-ho/ecopark-a">Bán căn hộ Ecopark A</a>
          <span>2PN, 58m², giá 3.6 tỷ</span>
        </div>
        <div class="re__card-info">
          <a class="js__product-link-for-product-id" href="/ban-can-ho/ecopark-b">Bán căn hộ Ecopark B</a>
          <span>3PN, 82m², giá 5.1 tỷ</span>
        </div>
      </body></html>
    `,
    new URL("https://batdongsan.com.vn/ban-can-ho-chung-cu-khu-do-thi-ecopark"),
    { itemSelector: "a.js__product-link-for-product-id" },
    new Date("2026-06-03T00:00:00.000Z"),
  );

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.sourceRef, "https://batdongsan.com.vn/ban-can-ho/ecopark-a");
  assert.match(result.items[0]?.text ?? "", /2PN, 58m², giá 3\.6 tỷ/);
  assert.equal(result.items[1]?.sourceRef, "https://batdongsan.com.vn/ban-can-ho/ecopark-b");
});

test("extractPageItems deduplicates overlapping listing card selectors by source URL", () => {
  const result = extractPageItems(
    `
      <html><head><title>Listings</title></head><body>
        <div class="js__card">
          <div class="re__card-info">
            <a class="js__product-link-for-product-id" href="/ban-can-ho/ecopark-a">Bán căn hộ Ecopark A</a>
            <span>2PN, 58m², giá 3.6 tỷ</span>
          </div>
        </div>
      </body></html>
    `,
    new URL("https://batdongsan.com.vn/ban-can-ho-chung-cu-khu-do-thi-ecopark"),
    {
      itemSelector: ".js__card, .re__card-info",
      linkSelector: "a.js__product-link-for-product-id",
    },
    new Date("2026-06-03T00:00:00.000Z"),
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.sourceRef, "https://batdongsan.com.vn/ban-can-ho/ecopark-a");
});

test("canonicalUrl sorts query params and removes hash and trailing slash", () => {
  assert.equal(canonicalUrl(new URL("https://Example.com/a/?z=2&a=1#x")), "https://example.com/a?a=1&z=2");
});

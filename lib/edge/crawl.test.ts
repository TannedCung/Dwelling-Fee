import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCrawlPage, parseCrawlConfig, splitResultSubmissions } from "../../edge/worker";

// The Cloudflare interstitial that actually blocked the live batdongsan.com.vn
// crawl: HTTP 403, "Just a moment...", "Performing security verification".
const CLOUDFLARE_HTML = `<!DOCTYPE html><html><head><title>Just a moment...</title>
<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></head>
<body class="no-js"><div id="cf-browser-verification">
<h1>batdongsan.com.vn</h1><p>Performing security verification</p>
<p>This website uses a security service to protect against malicious bots.</p>
</div></body></html>`;
const CLOUDFLARE_TEXT =
  "batdongsan.com.vn Performing security verification This website uses a security service " +
  "to protect against malicious bots. Verification successful. Waiting for batdongsan.com.vn to respond";

const LISTING_HTML = `<!DOCTYPE html><html><head><title>Bán căn hộ Ecopark</title></head>
<body><main><article><h1>Bán căn hộ Ecopark Park Premium</h1>
<p>Diện tích 58m2, 2PN, giá 3.6 tỷ, sổ hồng chính chủ.</p></article></main></body></html>`;
const LISTING_TEXT = "Bán căn hộ Ecopark Park Premium Diện tích 58m2, 2PN, giá 3.6 tỷ, sổ hồng chính chủ.";

test("flags Cloudflare challenge as needs-user-action via visible text", () => {
  const verdict = classifyCrawlPage(CLOUDFLARE_HTML, CLOUDFLARE_TEXT, 403);
  assert.equal(verdict.kind, "blocked");
});

test("flags anti-bot challenge from HTML even when visible text is empty", () => {
  const verdict = classifyCrawlPage(CLOUDFLARE_HTML, "", 200);
  assert.equal(verdict.kind, "blocked");
});

test("allows visible listing content even when stale challenge markup remains in HTML", () => {
  const html = LISTING_HTML.replace("</head>", `<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></head>`);
  const verdict = classifyCrawlPage(html, LISTING_TEXT, 200);
  assert.equal(verdict.kind, "ok");
});

test("treats 403/429/401 as blocked (bot-protected origin)", () => {
  for (const status of [401, 403, 429]) {
    assert.equal(classifyCrawlPage("<html></html>", "hello", status).kind, "blocked", `status ${status}`);
  }
});

test("treats other 4xx/5xx as a transport error, not ingestable content", () => {
  assert.equal(classifyCrawlPage("<html></html>", "not found", 404).kind, "error");
  assert.equal(classifyCrawlPage("<html></html>", "boom", 502).kind, "error");
});

test("passes a real listing page through", () => {
  const verdict = classifyCrawlPage(LISTING_HTML, LISTING_TEXT, 200);
  assert.equal(verdict.kind, "ok");
});

test("passes a real listing page when status is undefined", () => {
  assert.equal(classifyCrawlPage(LISTING_HTML, LISTING_TEXT).kind, "ok");
});

test("uses Batdongsan listing-card defaults for edge sources", () => {
  const config = parseCrawlConfig("https://batdongsan.com.vn/ban-can-ho-chung-cu-khu-do-thi-ecopark", null);

  assert.match(config.itemSelector ?? "", /re__card-info/);
  assert.match(config.linkSelector ?? "", /js__product-link-for-product-id/);
  assert.equal(config.minItems, 1);
  assert.equal(config.solveTimeoutMs, null);
});

test("allows explicit edge source selectors and min item gates to override defaults", () => {
  const config = parseCrawlConfig("https://batdongsan.com.vn/ban-can-ho-chung-cu-khu-do-thi-ecopark", {
    itemSelector: ".listing",
    linkSelector: "a.title",
    minItems: 3,
    solveTimeoutMs: 120_000,
  });

  assert.equal(config.itemSelector, ".listing");
  assert.equal(config.linkSelector, "a.title");
  assert.equal(config.minItems, 3);
  assert.equal(config.solveTimeoutMs, 120_000);
});

test("splits edge result submissions into API-sized item batches", () => {
  const pages = [{ canonicalUrl: "https://example.test/listings" }];
  const items = Array.from({ length: 25 }, (_, index) => ({ sourceRef: `item-${index}` }));

  const submissions = splitResultSubmissions(pages, items);

  assert.equal(submissions.length, 3);
  assert.deepEqual(submissions.map((entry) => entry.items.length), [10, 10, 5]);
  assert.equal(submissions[0]?.pages.length, 1);
  assert.equal(submissions[1]?.pages.length, 0);
  assert.equal(submissions[2]?.pages.length, 0);
});

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { chromium, type BrowserContext } from "playwright";
import { crawlPage, parseCrawlConfig, NeedsUserAction } from "../edge/worker";

/**
 * End-to-end check of the edge worker's crawl step against a real Chromium
 * browser and local fixtures — no external sites, no LLM. Proves that:
 *  - a real listing page yields extractable item text (the input to ingest), and
 *  - a Cloudflare-style 403 challenge is rejected as needs-user-action instead of
 *    being silently ingested as a zero-observation "success" (the live bug).
 */

const LISTING_HTML = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">
<title>Bán căn hộ Ecopark Park Premium</title></head>
<body><main><article>
<h1>Bán căn hộ Ecopark Park Premium</h1>
<p>Diện tích 58m2, 2PN1VS, ban công Đông Nam, tầng cao.</p>
<p>Giá bán 3.6 tỷ, sổ hồng chính chủ, thương lượng.</p>
</article></main></body></html>`;

// Mirrors the real Cloudflare interstitial that returned HTTP 403 from
// batdongsan.com.vn and produced zero observations.
const CHALLENGE_HTML = `<!DOCTYPE html><html><head><title>Just a moment...</title>
<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></head>
<body class="no-js"><div id="cf-browser-verification">
<h1>batdongsan.com.vn</h1>
<p>Performing security verification</p>
<p>This website uses a security service to protect against malicious bots.</p>
</div></body></html>`;

let server: Server;
let context: BrowserContext;
let origin: string;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/challenge")) {
      res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
      res.end(CHALLENGE_HTML);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(LISTING_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
  context = await chromium.launchPersistentContext("", { headless: true });
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("crawls a real listing page into extractable item text", async () => {
  const url = new URL(`${origin}/listing`);
  const config = parseCrawlConfig(url.href, { maxPages: 1, requestDelayMs: 0, maxDepth: 0 });
  const result = await crawlPage(context, url, config);

  expect(result.page.status).toBe("fetched");
  expect(result.items.length).toBeGreaterThan(0);
  const text = result.items.map((item) => item.text).join("\n");
  expect(text).toContain("3.6 tỷ");
  expect(text).toContain("58m2");
});

test("rejects a Cloudflare challenge as needs-user-action (no junk ingested)", async () => {
  const url = new URL(`${origin}/challenge`);
  const config = parseCrawlConfig(url.href, { maxPages: 1, requestDelayMs: 0, maxDepth: 0 });
  await expect(crawlPage(context, url, config)).rejects.toBeInstanceOf(NeedsUserAction);
});

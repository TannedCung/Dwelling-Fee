import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import type { BrowserContext } from "playwright";
import { crawlPage, parseCrawlConfig, NeedsUserAction, launchEdgeBrowserContext } from "../edge/worker";

/**
 * End-to-end check of the edge worker's crawl step against a real Chromium
 * browser and local fixtures — no external sites, no LLM. Proves that:
 *  - a real listing page yields extractable item text (the input to ingest), and
 *  - a browser-cleared challenge continues to post extraction, and
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

const CHALLENGE_THEN_LISTING_HTML = `<!DOCTYPE html><html><head><title>Just a moment...</title></head>
<body class="no-js"><div id="cf-browser-verification">
<p>Performing security verification</p>
</div><script>
setTimeout(() => {
  document.open();
  document.write(${JSON.stringify(LISTING_HTML)});
  document.close();
}, 100);
</script></body></html>`;

let server: Server;
let context: BrowserContext;
let origin: string;
let profileDir: string;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/robots.txt")) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("User-agent: *\nDisallow: /robots-blocked\n");
      return;
    }
    if (req.url?.startsWith("/challenge-then-listing")) {
      res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
      res.end(CHALLENGE_THEN_LISTING_HTML);
      return;
    }
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
  profileDir = await mkdtemp(path.join(tmpdir(), "dwelling-fee-edge-"));
  context = await launchEdgeBrowserContext({ profileDir, headless: true, chromiumSandbox: false });
});

test.afterAll(async () => {
  await context?.close();
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("launches the edge browser with stealth plugin hardening", async () => {
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/listing`);
    await expect.poll(() => page.evaluate(() => navigator.webdriver)).toBeFalsy();
  } finally {
    await page.close();
  }
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

test("continues after an access challenge clears in the worker browser", async () => {
  const url = new URL(`${origin}/challenge-then-listing`);
  const config = parseCrawlConfig(url.href, { maxPages: 1, requestDelayMs: 0, maxDepth: 0 });
  const reports: Array<{ url: string; reason: string; solveDeadlineAt: Date }> = [];
  const result = await crawlPage(context, url, config, {
    timeoutMs: 10_000,
    reportRequired: async (input) => {
      reports.push(input);
    },
  });

  expect(result.page.status).toBe("fetched");
  expect(reports).toHaveLength(1);
  expect(reports[0]?.url).toBe(url.href);
  expect(reports[0]?.reason).toBeTruthy();
  expect(result.items.length).toBeGreaterThan(0);
  expect(result.items.map((item) => item.text).join("\n")).toContain("3.6 tỷ");
});

test("respects robots.txt before opening an edge browser page", async () => {
  const url = new URL(`${origin}/robots-blocked`);
  const config = parseCrawlConfig(url.href, { maxPages: 1, requestDelayMs: 0, maxDepth: 0 });
  await expect(crawlPage(context, url, config)).rejects.toThrow(/robots\.txt disallows edge crawl/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalUrl,
  createHttpFetcher,
  extractPageItems,
  extractLinks,
  visibleText,
} from "./http-fetcher";
import type { CollectionSourceRef } from "./fetchers";

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

test("http fetcher respects robots, domain allowlist, link filters, and max pages", async () => {
  const calls: string[] = [];
  const fetcher = createHttpFetcher({
    fetch: fixtureFetch(calls, {
      "https://example.com/robots.txt": text("User-agent: *\nAllow: /\n"),
      "https://example.com/search": html(`
        <html>
          <head><title>Search</title></head>
          <body>
            <h1>Search page</h1>
            <a href="/listing/a">Listing A</a>
            <a href="https://outside.test/listing/b">Outside</a>
            <a href="/image.png">Image</a>
          </body>
        </html>
      `),
      "https://example.com/listing/a": html(`
        <html>
          <head><title>Listing A</title></head>
          <body><p>Bán căn hộ 72m² giá 5.2 tỷ</p></body>
        </html>
      `),
    }),
    sleep: async () => undefined,
    now: () => new Date("2026-06-03T00:00:00.000Z"),
  });

  const source: CollectionSourceRef = {
    id: "source-1",
    label: "Example",
    url: "https://example.com/search",
    kind: "http",
    config: {
      followLinks: true,
      includeUrlPatterns: ["/listing/"],
      maxPages: 2,
      requestDelayMs: 0,
    },
  };

  const result = await fetcher.fetch(source);

  assert.deepEqual(calls, [
    "https://example.com/robots.txt",
    "https://example.com/search",
    "https://example.com/listing/a",
  ]);
  assert.equal(result.items.length, 2);
  assert.equal(result.pages.length, 2);
  assert.equal(result.items[0]?.sourceRef, "https://example.com/search");
  assert.equal(result.items[1]?.sourceRef, "https://example.com/listing/a");
  assert.equal(result.items[1]?.sourceType, "web");
  assert.match(result.items[1]?.text ?? "", /Bán căn hộ 72m² giá 5.2 tỷ/);
  assert.equal(result.items[0]?.capturedAt?.toISOString(), "2026-06-03T00:00:00.000Z");
});

test("http fetcher blocks robots-disallowed source URLs", async () => {
  const fetcher = createHttpFetcher({
    fetch: fixtureFetch([], {
      "https://example.com/robots.txt": text("User-agent: *\nDisallow: /private\n"),
      "https://example.com/private/listing": html("<p>should not fetch</p>"),
    }),
  });

  const result = await fetcher.fetch({
    id: "source-2",
    label: "Private",
    url: "https://example.com/private/listing",
    kind: "http",
    config: null,
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.pages[0]?.status, "failed");
  assert.match(result.pages[0]?.error ?? "", /robots\.txt disallows/);
});

test("http fetcher sends validators and skips 304 unchanged pages", async () => {
  const requests: Array<{ url: string; ifNoneMatch: string | null }> = [];
  const fetcher = createHttpFetcher({
    fetch: (async (input, init) => {
      const url = input instanceof URL ? input.href : String(input);
      const headers = new Headers(init?.headers);
      requests.push({ url, ifNoneMatch: headers.get("if-none-match") });
      if (url === "https://example.com/robots.txt") return text("User-agent: *\nAllow: /\n");
      return new Response(null, { status: 304, headers: { etag: '"abc"' } });
    }) as typeof fetch,
  });

  const result = await fetcher.fetch(
    { id: "source-3", label: "Cached", url: "https://example.com/listing/a", kind: "http", config: null },
    {
      cachedPages: new Map([
        [
          "https://example.com/listing/a",
          { canonicalUrl: "https://example.com/listing/a", etag: '"abc"', lastModified: null, contentHash: null, textHash: null },
        ],
      ]),
    },
  );

  assert.equal(requests.find((r) => r.url === "https://example.com/listing/a")?.ifNoneMatch, '"abc"');
  assert.equal(result.items.length, 0);
  assert.equal(result.pages[0]?.status, "skipped_unchanged");
});

test("http fetcher follows sitemap URLs from a sitemap source", async () => {
  const calls: string[] = [];
  const fetcher = createHttpFetcher({
    fetch: fixtureFetch(calls, {
      "https://example.com/robots.txt": text("User-agent: *\nAllow: /\n"),
      "https://example.com/sitemap.xml": xml(`
        <urlset>
          <url><loc>https://example.com/listing/a</loc></url>
        </urlset>
      `),
      "https://example.com/listing/a": html("<main>Bán nhà phố 80m² giá 8 tỷ</main>"),
    }),
    sleep: async () => undefined,
  });

  const result = await fetcher.fetch({
    id: "source-4",
    label: "Sitemap",
    url: "https://example.com/sitemap.xml",
    kind: "http",
    config: { maxPages: 2, requestDelayMs: 0 },
  });

  assert.deepEqual(calls, [
    "https://example.com/robots.txt",
    "https://example.com/sitemap.xml",
    "https://example.com/listing/a",
  ]);
  assert.equal(result.items.length, 1);
  assert.match(result.items[0]?.text ?? "", /Bán nhà phố 80m² giá 8 tỷ/);
});

test("canonicalUrl sorts query params and removes hash and trailing slash", () => {
  assert.equal(canonicalUrl(new URL("https://Example.com/a/?z=2&a=1#x")), "https://example.com/a?a=1&z=2");
});

function fixtureFetch(calls: string[], fixtures: Record<string, Response>): typeof fetch {
  return (async (input) => {
    const url = input instanceof URL ? input.href : String(input);
    calls.push(url);
    return fixtures[url] ?? new Response("missing", { status: 404 });
  }) as typeof fetch;
}

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

function text(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function xml(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/xml; charset=utf-8" } });
}

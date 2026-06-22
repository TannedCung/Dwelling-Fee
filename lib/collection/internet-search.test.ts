import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTERNET_SEARCH_CAVEAT,
  INTERNET_SEARCH_EVIDENCE_LABEL,
  INTERNET_SEARCH_EVIDENCE_TIER,
  searchInternetForProjectInformation,
} from "./internet-search";

test("internet search returns a Tier 2 configuration warning when provider key is missing", async () => {
  const calls: string[] = [];
  const result = await searchInternetForProjectInformation(
    { query: "The Metropole Thu Thiem", purpose: "entity resolution" },
    {
      apiKey: "",
      now: () => new Date("2026-06-22T00:00:00.000Z"),
      fetch: fixtureFetch(calls, {}),
    },
  );

  assert.equal(result.tier, INTERNET_SEARCH_EVIDENCE_TIER);
  assert.equal(result.tierLabel, INTERNET_SEARCH_EVIDENCE_LABEL);
  assert.equal(result.caveat, INTERNET_SEARCH_CAVEAT);
  assert.equal(result.retrievedAt, "2026-06-22T00:00:00.000Z");
  assert.deepEqual(result.results, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /BRAVE_SEARCH_API_KEY/);
  assert.deepEqual(calls, []);
});

test("internet search maps Brave results and marks every result as Tier 2", async () => {
  const calls: string[] = [];
  const result = await searchInternetForProjectInformation(
    {
      query: "Lumiere Riverside tower address",
      purpose: "building wiki grounding",
      limit: 2,
      country: "vn",
      searchLang: "en",
    },
    {
      apiKey: "test-key",
      now: () => new Date("2026-06-22T01:00:00.000Z"),
      fetch: fixtureFetch(calls, {
        "https://api.search.brave.com/res/v1/web/search": json({
          web: {
            results: [
              {
                title: "Lumiere Riverside",
                url: "https://example.com/lumiere",
                description: "Project overview and address.",
                page_age: "2026-06-01T00:00:00Z",
              },
              {
                title: "Developer page",
                url: "https://developer.example.vn/project",
                description: "Official-looking project page.",
              },
              {
                title: "Extra result",
                url: "https://extra.example.vn/project",
                description: "Should be trimmed by limit.",
              },
            ],
          },
        }),
      }),
    },
  );

  assert.equal(result.query, "Lumiere Riverside tower address");
  assert.equal(result.purpose, "building wiki grounding");
  assert.equal(result.provider, "brave");
  assert.equal(result.tier, INTERNET_SEARCH_EVIDENCE_TIER);
  assert.equal(result.results.length, 2);
  assert.deepEqual(calls, [
    "https://api.search.brave.com/res/v1/web/search?q=Lumiere+Riverside+tower+address&count=2&country=VN&search_lang=en",
  ]);

  assert.equal(result.results[0]?.title, "Lumiere Riverside");
  assert.equal(result.results[0]?.source, "example.com");
  assert.equal(result.results[0]?.publishedAt, "2026-06-01T00:00:00Z");
  for (const item of result.results) {
    assert.equal(item.tier, INTERNET_SEARCH_EVIDENCE_TIER);
    assert.equal(item.tierLabel, INTERNET_SEARCH_EVIDENCE_LABEL);
    assert.equal(item.caveat, INTERNET_SEARCH_CAVEAT);
  }
});

test("internet search rejects empty queries", async () => {
  await assert.rejects(
    () => searchInternetForProjectInformation({ query: "   " }, { apiKey: "test-key" }),
    /search query is required/,
  );
});

function fixtureFetch(calls: string[], fixtures: Record<string, Response>): typeof fetch {
  return (async (input) => {
    const url = input instanceof URL ? input.href : String(input);
    const fixture = fixtures[input instanceof URL ? input.origin + input.pathname : url] ?? fixtures[url];
    calls.push(url);
    return fixture ?? new Response("missing", { status: 404 });
  }) as typeof fetch;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

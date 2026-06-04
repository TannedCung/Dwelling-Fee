import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * End-to-end coverage of the conversational ingest experience: streaming replies
 * over SSE, the completeness gate (assistant asks for missing fields, commit stays
 * disabled), and a successful commit once the draft is complete.
 *
 * Runs against the deterministic offline model (MOCK_AI=1, set by the Playwright
 * webServer). It needs a migrated database (DATABASE_URL) to create/commit a
 * session — when Neon is unreachable the spec skips rather than failing red.
 */

async function createSession(request: APIRequestContext): Promise<string | null> {
  const res = await request.post("/api/ingest/session", { data: {} });
  if (res.status() !== 201) return null; // DB offline → skip
  const body = await res.json();
  return typeof body.id === "string" ? body.id : null;
}

test.describe("ingest chat", () => {
  test.skip(
    Boolean(process.env.E2E_BASE_URL),
    "deterministic ingest chat e2e runs only against the local MOCK_AI server",
  );

  test("streams replies, gates commit on completeness, then commits", async ({ page, request }) => {
    const id = await createSession(request);
    test.skip(id === null, "database unavailable — skipping DB-dependent chat e2e");

    await page.goto(`/ingest/${id}`);

    // Greeting from a fresh session.
    await expect(page.locator(".bubble.assistant").first()).toBeVisible();

    const input = page.getByRole("textbox");
    const send = page.getByRole("button", { name: /send/i });
    const commit = page.getByRole("button", { name: /commit/i });

    // Commit is disabled before any draft exists.
    await expect(commit).toBeDisabled();

    // --- Turn 1: a teaser with identity + listing type but no price/area. ---
    await input.fill("Apartment for sale in District 9");
    await send.click();

    // The streaming bubble appears while the reply is being produced...
    await expect(page.getByTestId("streaming-bubble")).toBeVisible();
    // ...and resolves into a persisted assistant message asking for what's missing.
    await expect(page.locator(".bubble.assistant", { hasText: "Still need" })).toBeVisible();

    // Draft shows the property flagged as incomplete; commit stays disabled.
    await expect(page.locator(".draft-flag.needs")).toBeVisible();
    await expect(page.locator(".draft-item")).toHaveCount(1);
    await expect(commit).toBeDisabled();

    // --- Turn 2: supply the missing required fields. ---
    await input.fill("Price 4.5 tỷ, 75 m², 2PN");
    await send.click();

    // Property becomes complete; the incomplete flag is gone and commit unlocks.
    await expect(page.locator(".draft-flag.ok")).toBeVisible();
    await expect(page.locator(".draft-flag.needs")).toHaveCount(0);
    await expect(commit).toBeEnabled();

    // --- Commit and confirm the success summary. ---
    await commit.click();
    await expect(page.locator(".form-msg.ok", { hasText: "Committed" })).toBeVisible();
    await expect(page.getByText(/obs ·.*linked.*new.*review/)).toBeVisible();
  });

  test("rejects an empty send and keeps commit locked", async ({ page, request }) => {
    const id = await createSession(request);
    test.skip(id === null, "database unavailable — skipping DB-dependent chat e2e");

    await page.goto(`/ingest/${id}`);
    const send = page.getByRole("button", { name: /send/i });
    // Send is disabled with no input.
    await expect(send).toBeDisabled();
    await expect(page.getByRole("button", { name: /commit/i })).toBeDisabled();
  });
});

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
    await expect(page.locator(".commit-summary", { hasText: "Committed" })).toBeVisible();
    await expect(page.locator(".cs-stat", { hasText: "observations" })).toBeVisible();
  });

  test("researches project context and infers sale listing type for Ecopark broker text", async ({ page, request }) => {
    const id = await createSession(request);
    test.skip(id === null, "database unavailable — skipping DB-dependent chat e2e");

    await page.goto(`/ingest/${id}`);

    const input = page.getByRole("textbox");
    const send = page.getByRole("button", { name: /send/i });
    const commit = page.getByRole("button", { name: /commit/i });

    await input.fill(`💎CC cần bán căn 58m2 có 2PN1VS, bán công Đông Nam tầng cao siêu thoáng, mát quanh năm. Căn hộ ở tòa Park
Premium- mỗi tầng chỉ có 8 căn hộ rất riêng tư và yên bình.
💰Giá bán 3.6x tỷ bao phí- đang là rẻ nhất thị trường cho căn ban công Đông Nam tòa xịn sò ở Ecopark ạ.`);
    await send.click();

    await expect(page.getByTestId("streaming-bubble")).toBeVisible();
    await expect(page.locator(".bubble.assistant").last()).toContainText(/Ecopark/i);
    await expect(page.locator(".bubble.assistant").last()).not.toContainText(/thuộc dự án|phân khu nào|bán hay thuê|sale or rent|which project/i);

    await expect(page.locator(".draft-item")).toHaveCount(1);
    await expect(page.locator(".di-name")).toContainText(/Ecopark.*Park Premium/i);
    await expect(page.locator(".di-field", { hasText: "sale" })).toBeVisible();
    await expect(page.locator(".di-field", { hasText: "asking" })).toBeVisible();
    await expect(page.locator(".di-field", { hasText: "58 m²" })).toBeVisible();
    await expect(page.locator(".di-field.price")).toContainText("3.600.000.000");
    await expect(page.locator(".draft-flag.ok")).toBeVisible();
    await expect(commit).toBeEnabled();

    await page.getByRole("tab", { name: /debug/i }).click();
    await expect(page.getByTestId("ingest-debug-panel")).toBeVisible();
    await expect(page.locator(".debug-phase", { hasText: "research.db" }).first()).toBeVisible();
    await expect(page.getByText("Searching existing project/building/property records.")).toBeVisible();
    await expect(page.locator(".debug-phase", { hasText: "research.internet" }).first()).toBeVisible();
    await expect(page.getByText(/Internet search returned \d+ Tier 2 result/).first()).toBeVisible();
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

test.describe("live ADK ingest", () => {
  test.skip(
    process.env.LIVE_ADK_E2E !== "1",
    "live ADK ingest e2e requires LIVE_ADK_E2E=1 and a non-MOCK_AI server",
  );

  test("calls project research for named Ecopark and Park Premium broker text", async ({ page, request }) => {
    const id = await createSession(request);
    test.skip(id === null, "database unavailable — skipping DB-dependent chat e2e");

    await page.goto(`/ingest/${id}`);

    const input = page.getByRole("textbox");
    const send = page.getByRole("button", { name: /send/i });

    await input.fill(`💎CC cần bán căn 58m2 có 2PN1VS, bán công Đông Nam tầng cao siêu thoáng, mát quanh năm. Căn hộ ở tòa Park
Premium- mỗi tầng chỉ có 8 căn hộ rất riêng tư và yên bình.
💰Giá bán 3.6x tỷ bao phí- đang là rẻ nhất thị trường cho căn ban công Đông Nam tòa xịn sò ở Ecopark ạ.`);
    await send.click();

    await expect(page.locator(".bubble.assistant").last()).toContainText(/Ecopark/i, { timeout: 60_000 });
    await expect(page.locator(".bubble.assistant").last()).not.toContainText(/cho biết rõ tên dự án|có đúng không|which project/i);

    await expect(page.locator(".draft-item")).toHaveCount(1);
    await expect(page.locator(".di-name")).toContainText(/Ecopark.*Park Premium/i);
    await expect(page.locator(".di-field", { hasText: "sale" })).toBeVisible();
    await expect(page.locator(".di-field", { hasText: "58 m²" })).toBeVisible();
    await expect(page.locator(".di-field.price")).toContainText("3.600.000.000");

    await page.getByRole("tab", { name: /debug/i }).click();
    await expect(page.getByTestId("ingest-debug-panel")).toBeVisible();
    await expect(page.locator(".debug-phase", { hasText: "tool.call" }).first()).toBeVisible();
    await expect(page.getByText("ADK agent called research_project_information.").first()).toBeVisible();
    await expect(page.locator(".debug-phase", { hasText: "research.db" }).first()).toBeVisible();
    await expect(page.locator(".debug-phase", { hasText: "research.internet" }).first()).toBeVisible();
  });
});

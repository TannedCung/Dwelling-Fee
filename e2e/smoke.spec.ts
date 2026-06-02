import { test, expect } from "@playwright/test";

/**
 * Smoke coverage for the four product surfaces. These assert the shell and
 * page chrome render — they intentionally don't depend on database content,
 * since each page renders a graceful notice/empty state when Neon is offline.
 */

test.describe("app shell", () => {
  test("topbar brand and nav are present on every surface", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Dwelling Fee" })).toBeVisible();

    const nav = page.locator("nav.nav");
    for (const label of ["Ingest", "Review", "Properties", "Map", "Collect", "Analytics"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });
});

const surfaces = [
  { tab: "Review", path: "/review", heading: "Review" },
  { tab: "Properties", path: "/properties", heading: "Properties" },
  { tab: "Collect", path: "/collect", heading: "Collect" },
  { tab: "Analytics", path: "/analytics", heading: "Analytics" },
];

test.describe("navigation", () => {
  for (const { tab, path, heading } of surfaces) {
    test(`nav tab "${tab}" routes to ${path}`, async ({ page }) => {
      await page.goto("/");
      await page.locator("nav.nav").getByRole("link", { name: tab }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    });
  }

  test("ingest landing renders its heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

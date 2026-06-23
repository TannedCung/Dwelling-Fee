import { test, expect } from "@playwright/test";

/**
 * Smoke coverage for the product surfaces. These assert the shell and
 * page chrome render — they intentionally don't depend on database content,
 * since each page renders a graceful notice/empty state when Neon is offline.
 */

test.describe("app shell", () => {
  test("topbar brand and nav are present on every surface", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Dwelling Fee" })).toBeVisible();

    const nav = page.locator("nav.nav");
    for (const label of ["Ingest", "Review", "Projects", "Properties", "Map", "Collect", "Edge", "Analytics"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });
});

const surfaces = [
  { tab: "Review", path: "/review", heading: "Review" },
  { tab: "Projects", path: "/projects", heading: "Projects" },
  { tab: "Properties", path: "/properties", heading: "Properties" },
  { tab: "Collect", path: "/collect", heading: "Collect" },
  { tab: "Edge", path: "/edge-devices", heading: "Edge Devices" },
  { tab: "Analytics", path: "/analytics", heading: "Analytics" },
];

test.describe("navigation", () => {
  for (const { tab, path, heading } of surfaces) {
    test(`nav tab "${tab}" links to ${path}`, async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("nav.nav").getByRole("link", { name: tab })).toHaveAttribute("href", path);
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    });
  }

  test("ingest workspace renders its starter panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Start a collection session" })).toBeVisible();
  });
});

import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./e2e/auth-constants";

/**
 * E2E config. Tests run against a local Next.js server which Playwright starts
 * for us (reusing an already-running dev server when present). The app's pages
 * degrade gracefully when the database is unreachable, so the smoke tests stay
 * green even without a live Neon connection.
 */
const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    // Mints a signed-in session cookie once; the app is gated behind sign-in.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        env: {
          // Deterministic, offline LLM so the ingest chat is testable without an
          // AI provider/key; small per-chunk delay makes streaming observable.
          MOCK_AI: "1",
          MOCK_AI_STREAM_DELAY_MS: "25",
          // AUTH_SECRET / AUTH_ALLOWED_EMAILS intentionally come from .env (which
          // next dev loads): auth.setup.ts reads the same .env to mint a matching
          // session cookie, so both sides agree without any override.
        },
      },
});

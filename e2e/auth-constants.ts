import { createRequire } from "node:module";

// @next/env is CommonJS; require it for interop across the tsx/Playwright loaders.
const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as typeof import("@next/env");

/**
 * Shared constants for e2e authentication. The app is gated behind Google
 * sign-in (see middleware.ts), which can't run in an offline test. Instead of
 * adding an auth-bypass path to production code, the tests mint a *real* Auth.js
 * JWT session cookie (see auth.setup.ts) signed with the same AUTH_SECRET the
 * dev server uses — so the genuine middleware/session path is exercised.
 *
 * The dev server (next dev, started by the Playwright webServer) resolves its
 * secret and allowlist from .env. We load the very same env here so both sides
 * agree without having to override anything — sign in as a real allowlisted
 * email with the real secret.
 */
loadEnvConfig(process.cwd());

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `e2e: ${name} must be set (e.g. in .env) — auth-gated tests sign a session with it.`,
    );
  }
  return value;
}

export const AUTH_SECRET = required("AUTH_SECRET");

// First entry of the dev server's sign-in allowlist (AUTH_ALLOWED_EMAILS).
export const ALLOWED_EMAIL = required("AUTH_ALLOWED_EMAILS")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean)[0]!;

// Auth.js v5 names the JWT session cookie `authjs.session-token` over plain
// http and `__Secure-authjs.session-token` over https. The cookie name is also
// the salt used to derive the encryption key, so encode/decode must agree on it.
export function sessionCookieName(baseURL: string | undefined): string {
  const protocol = new URL(baseURL ?? "http://localhost:3000").protocol;
  return protocol === "https:" ? "__Secure-authjs.session-token" : "authjs.session-token";
}

export const STORAGE_STATE = "e2e/.auth/state.json";

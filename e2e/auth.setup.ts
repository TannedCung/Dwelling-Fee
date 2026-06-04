import { test as setup } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { AUTH_SECRET, ALLOWED_EMAIL, sessionCookieName, STORAGE_STATE } from "./auth-constants";

/**
 * Authentication setup project. Runs once before the other specs and saves a
 * signed-in browser state to STORAGE_STATE, which the chromium project loads.
 *
 * Rather than stubbing auth, this mints a genuine Auth.js JWT session token —
 * the same encrypted cookie NextAuth would issue after a Google sign-in — for an
 * allowlisted email. The dev server validates it with the shared AUTH_SECRET, so
 * the real middleware gate runs; we only skip the external Google round-trip.
 */
setup("authenticate", async ({ context, baseURL }) => {
  const cookieName = sessionCookieName(baseURL);
  const token = await encode({
    salt: cookieName,
    secret: AUTH_SECRET,
    token: { name: "E2E Tester", email: ALLOWED_EMAIL, sub: "e2e-user" },
  });

  const { hostname, protocol } = new URL(baseURL ?? "http://localhost:3000");
  await context.addCookies([
    {
      name: cookieName,
      value: token,
      domain: hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: protocol === "https:",
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
    },
  ]);

  await context.storageState({ path: STORAGE_STATE });
});

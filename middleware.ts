import { auth } from "./auth";
import { isAllowedEmail } from "./auth";

/**
 * Gate the entire app behind Google sign-in. Unauthenticated (or not-allowlisted)
 * requests are redirected to /signin; the original path is preserved in
 * ?callbackUrl so the user lands back where they were after authenticating.
 */
export default auth((req) => {
  // The home page is the public marketing landing — always reachable so it can
  // be crawled and indexed. (Authenticated users get the app dashboard there.)
  if (req.nextUrl.pathname === "/") return;

  const allowed = isAllowedEmail(req.auth?.user?.email);
  if (allowed) return;

  const url = new URL("/signin", req.nextUrl.origin);
  url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
  return Response.redirect(url);
});

export const config = {
  // Run on everything except Next internals, the auth API, the cron endpoint
  // (which guards itself with CRON_SECRET), the sign-in page, and static asset
  // files (anything with a file extension).
  matcher: ["/((?!api/auth|api/cron|signin|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};

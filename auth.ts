import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Auth.js (NextAuth v5) — Google sign-in gating the whole app.
 *
 * Sessions are JWT-based (no database round-trip), so this config is safe to
 * import from middleware on the edge. Access is restricted to an allowlist of
 * email addresses supplied via AUTH_ALLOWED_EMAILS (comma-separated). Anyone
 * else can authenticate with Google but is rejected by the `signIn` callback.
 */

const allowedEmails = new Set(
  (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  // Empty allowlist = closed: nobody gets in until it's configured.
  return allowedEmails.has(email.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    // Reject anyone not on the allowlist before a session is ever issued.
    signIn({ profile }) {
      return isAllowedEmail(profile?.email);
    },
    // Defense in depth: middleware/server checks consult this too.
    authorized({ auth }) {
      return isAllowedEmail(auth?.user?.email);
    },
  },
  pages: {
    signIn: "/signin",
  },
});

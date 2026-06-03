import { redirect } from "next/navigation";
import { auth, signIn, isAllowedEmail } from "../../auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;

  // Already signed in and allowed? Skip the page.
  const session = await auth();
  if (isAllowedEmail(session?.user?.email)) {
    redirect(callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/");
  }

  // Google authenticated them but they're not on the allowlist.
  const deniedEmail = session?.user?.email;
  const accessDenied = error === "AccessDenied" || (session?.user && !isAllowedEmail(deniedEmail));

  return (
    <main style={{ display: "flex", justifyContent: "center", marginTop: "12vh" }}>
      <div className="card" style={{ maxWidth: 400, width: "100%", textAlign: "center", padding: "32px 28px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.svg" alt="" width={44} height={44} style={{ margin: "0 auto 14px" }} />
        <h1 style={{ font: "var(--text-h3)", margin: "0 0 6px" }}>Dwelling Fee</h1>
        <p className="muted" style={{ margin: "0 0 22px" }}>
          {accessDenied
            ? "This account isn't authorized for access."
            : "Sign in to continue."}
        </p>

        {accessDenied && deniedEmail && (
          <p className="muted" style={{ margin: "0 0 18px", fontSize: 13 }}>
            Signed in as <span className="mono">{deniedEmail}</span> — ask an admin to add you to the allowlist.
          </p>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("google", {
              redirectTo: callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/",
            });
          }}
        >
          <button type="submit" className="btn primary" style={{ width: "100%", justifyContent: "center", padding: "11px 16px" }}>
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}

import { auth, signOut } from "../../auth";

/** Shows the signed-in account and a sign-out button in the topbar. */
export async function UserMenu() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span className="muted" title={email} style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {email}
      </span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/signin" });
        }}
      >
        <button type="submit" className="btn ghost sm">Sign out</button>
      </form>
    </div>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { Nav } from "./_components/nav";
import { UserMenu } from "./_components/user-menu";
import { ToastProvider } from "./_components/toast";
import { reviewQueueCount } from "../lib/review";
import { logger } from "../lib/log";
import { auth, isAllowedEmail } from "../auth";

export const metadata = {
  title: "Dwelling Fee — Housing Price Intelligence",
  description: "Collect, structure, and analyze fragmented housing price signals.",
  icons: {
    icon: "/logo-mark.svg",
    shortcut: "/logo-mark.svg",
    apple: "/logo-mark.svg",
  },
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const authed = isAllowedEmail(session?.user?.email);

  return (
    <html lang="en">
      <body>
        <ToastProvider>{authed ? <AppShell>{children}</AppShell> : children}</ToastProvider>
      </body>
    </html>
  );
}

// The in-app shell (topbar + nav) — only wraps authenticated pages. The public
// marketing landing at `/` renders without it.
async function AppShell({ children }: { children: ReactNode }) {
  let reviewCount = 0;
  try {
    reviewCount = await reviewQueueCount();
  } catch (e) {
    // database may be unavailable — the badge just stays hidden
    logger.warn("review count unavailable for layout badge", { error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" width={34} height={34} />
          <span className="wm">
            Dwelling Fee
            <small>Housing price intelligence</small>
          </span>
        </Link>
        <div className="topbar-spacer" />
        <Nav reviewCount={reviewCount} />
        <UserMenu />
      </header>
      {children}
    </div>
  );
}

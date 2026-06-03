import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { Nav } from "./_components/nav";
import { UserMenu } from "./_components/user-menu";
import { ToastProvider } from "./_components/toast";
import { reviewQueueCount } from "../lib/review";
import { logger } from "../lib/log";

export const metadata = {
  title: "Dwelling Fee — Housing Price Intelligence",
  description: "Collect, structure, and analyze fragmented housing price signals.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RootLayout({ children }: { children: ReactNode }) {
  let reviewCount = 0;
  try {
    reviewCount = await reviewQueueCount();
  } catch (e) {
    // database may be unavailable — the badge just stays hidden
    logger.warn("review count unavailable for layout badge", { error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <html lang="en">
      <body>
        <ToastProvider>
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
        </ToastProvider>
      </body>
    </html>
  );
}

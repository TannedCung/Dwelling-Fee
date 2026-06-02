import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { Nav } from "./_components/nav";
import { listReviewQueue } from "../lib/review";

export const metadata = {
  title: "Dwelling Fee — Housing Price Intelligence",
  description: "Collect, structure, and analyze fragmented housing price signals.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RootLayout({ children }: { children: ReactNode }) {
  let reviewCount = 0;
  try {
    reviewCount = (await listReviewQueue()).length;
  } catch {
    // database may be unavailable — the badge just stays hidden
  }

  return (
    <html lang="en">
      <body>
        <div className="app">
          <header className="topbar">
            <Link href="/" className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark.svg" alt="" width={34} height={34} />
              <span className="wm">Dwelling Fee</span>
            </Link>
            <Nav reviewCount={reviewCount} />
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}

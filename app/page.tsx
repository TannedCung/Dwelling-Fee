import type { Metadata, Viewport } from "next";
import { listSessions, type SessionListItem } from "../lib/ingest";
import { DatabaseError } from "./_components/notice";
import { describeError } from "../lib/page-error";
import { Icon } from "./_components/icon";
import { NewSessionButton } from "./_components/new-session-button";
import { SessionsRail } from "./ingest/sessions-rail";
import { auth, isAllowedEmail } from "../auth";
import { Landing } from "./_components/landing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SITE_URL = "https://dwelling-fee.vercel.app";

export const viewport: Viewport = { themeColor: "#F4EADA" };

// SEO for the public landing served at `/` to unauthenticated visitors.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Dwelling Fee — Housing price intelligence from real broker chatter",
  description:
    "Dwelling Fee turns fragmented broker messages, listings and screenshots into structured, queryable housing-price intelligence — so you can reason about what a home is actually worth, with provenance and confidence on every number.",
  keywords: [
    "housing price intelligence",
    "real estate data",
    "property valuation",
    "price per m2",
    "broker message extraction",
    "Vietnam real estate",
    "asking vs transacted price",
    "market analytics",
  ],
  authors: [{ name: "Dwelling Fee" }],
  alternates: { canonical: "/" },
  robots: { index: true, follow: true, "max-image-preview": "large" },
  openGraph: {
    type: "website",
    siteName: "Dwelling Fee",
    title: "Dwelling Fee — Housing price intelligence from real broker chatter",
    description:
      "Structured, queryable market intelligence from messy broker messages. Every fact carries provenance and a confidence score — never a single confident number.",
    url: "/",
    locale: "en_US",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Dwelling Fee — housing price intelligence" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dwelling Fee — Housing price intelligence",
    description:
      "Turn fragmented broker chatter into structured market intelligence — with provenance and confidence on every number.",
    images: ["/og-image.png"],
  },
};

export default async function Home() {
  const session = await auth();
  // Unauthenticated visitors (and crawlers) get the public marketing landing.
  if (!isAllowedEmail(session?.user?.email)) return <Landing />;
  return <Dashboard />;
}

async function Dashboard() {
  let sessions: SessionListItem[] = [];
  let error: string | null = null;
  try {
    sessions = await listSessions();
  } catch (e) {
    error = describeError(e, "home");
  }

  return (
    <main className="ingest-workspace rail-open">
      {error ? (
        <DatabaseError detail={error} />
      ) : (
        <>
          <SessionsRail sessions={sessions} />
          <div className="chat-grid">
            <section className="chat-panel">
              <div className="chat-topbar">
                <div className="icon-btn" aria-hidden="true">
                  <Icon name="panel-left" size={18} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="ct-title">
                    <Icon name="file-text" size={16} style={{ color: "var(--clay)" }} />
                    New ingest session
                  </div>
                  <div className="ct-meta">
                    <span>Paste a broker message, listing, or screenshot to start.</span>
                  </div>
                </div>
                <span className="badge open"><span className="dot" style={{ background: "currentColor" }} />open</span>
              </div>
              <div className="chat-log">
                <div className="chat-empty">
                  <div className="ce-mark">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo-mark.svg" alt="" />
                  </div>
                  <h3>Start a collection session</h3>
                  <p>
                    The assistant stores the raw signal first, then extracts structured observations and keeps a draft for review before commit.
                  </p>
                  <NewSessionButton />
                </div>
              </div>
              <div className="composer-locked">
                <Icon name="info" size={15} />
                Create a session to open the chat composer.
              </div>
            </section>

            <aside className="draft-panel">
              <div className="draft-card">
                <div className="draft-head">
                  <div className="dh-top">
                    <strong>Draft</strong>
                    <span className="muted">0 properties</span>
                  </div>
                  <div className="progress-track"><div className="progress-fill" style={{ width: "0%" }} /></div>
                  <div className="progress-label">
                    <span>0/0 complete</span>
                    <span>waiting for a signal</span>
                  </div>
                </div>
                <p className="muted" style={{ margin: "0 16px 16px" }}>
                  Draft cards appear here with price, area, confidence, missing fields, and commit readiness.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

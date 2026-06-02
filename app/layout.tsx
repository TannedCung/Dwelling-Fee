import type { ReactNode } from "react";

export const metadata = {
  title: "Dwelling Fee — Housing Price Intelligence",
  description: "Collect, structure, and analyze fragmented housing price signals.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          maxWidth: 880,
          margin: "0 auto",
          padding: "2rem 1.25rem",
          lineHeight: 1.5,
        }}
      >
        <nav style={{ display: "flex", gap: 16, marginBottom: 24, paddingBottom: 12, borderBottom: "1px solid #eee" }}>
          <a href="/">Ingest</a>
          <a href="/review">Review</a>
          <a href="/properties">Properties</a>
          <a href="/analytics">Analytics</a>
        </nav>
        {children}
      </body>
    </html>
  );
}

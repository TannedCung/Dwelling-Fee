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
        {children}
      </body>
    </html>
  );
}

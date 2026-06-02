"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";

const TABS = [
  { href: "/", label: "Ingest", icon: "inbox", match: (p: string) => p === "/" || p.startsWith("/ingest") },
  { href: "/review", label: "Review", icon: "list-checks", match: (p: string) => p.startsWith("/review") },
  { href: "/properties", label: "Properties", icon: "building", match: (p: string) => p.startsWith("/properties") },
  { href: "/map", label: "Map", icon: "map-pin", match: (p: string) => p.startsWith("/map") },
  { href: "/analytics", label: "Analytics", icon: "trending-up", match: (p: string) => p.startsWith("/analytics") },
];

export function Nav({ reviewCount = 0 }: { reviewCount?: number }) {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`tab ${t.match(pathname) ? "active" : ""}`}>
          <Icon name={t.icon} size={16} />
          {t.label}
          {t.href === "/review" && reviewCount > 0 && <span className="count">{reviewCount}</span>}
        </Link>
      ))}
    </nav>
  );
}

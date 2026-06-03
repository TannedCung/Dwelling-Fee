import type { ReactNode } from "react";
import { Icon } from "./icon";

/**
 * Inline status banner for server-rendered pages (the non-transient counterpart
 * to the client toast). One component so the "database unavailable" / info /
 * warning banners look and read the same everywhere.
 */
export function Notice({
  variant = "warning",
  children,
}: {
  variant?: "warning" | "info" | "danger";
  children: ReactNode;
}) {
  const icon = variant === "danger" ? "triangle-alert" : "info";
  const className = variant === "warning" ? "notice" : `notice ${variant}`;
  return (
    <div className={className}>
      <Icon name={icon} size={17} />
      <div>{children}</div>
    </div>
  );
}

/** Standard banner shown when a page can't reach the database. */
export function DatabaseError({ detail }: { detail?: string | null }) {
  return <Notice variant="danger">Database not reachable{detail ? ` (${detail})` : ""}.</Notice>;
}

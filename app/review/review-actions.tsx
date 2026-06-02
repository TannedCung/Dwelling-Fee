"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Candidate } from "../../lib/resolution";

export function ReviewActions({ observationId, candidates }: { observationId: string; candidates: Candidate[] }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  function act(body: Record<string, unknown>) {
    setErr(null);
    start(async () => {
      const res = await fetch(`/api/review/${observationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(typeof d.error === "string" ? d.error : "failed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {candidates.map((c) => (
        <button key={c.id} disabled={pending} onClick={() => act({ action: "link", propertyId: c.id })}
          style={{ padding: "4px 10px", cursor: "pointer" }}>
          Link → {c.name ?? "(unnamed)"} <span style={{ color: "#888" }}>{(c.score * 100).toFixed(0)}%</span>
        </button>
      ))}
      <button disabled={pending} onClick={() => act({ action: "create" })} style={{ padding: "4px 10px", cursor: "pointer" }}>
        + Create new
      </button>
      <button disabled={pending} onClick={() => act({ action: "dismiss" })} style={{ padding: "4px 10px", cursor: "pointer", color: "#b00" }}>
        Dismiss
      </button>
      {err && <span style={{ color: "#b00", fontSize: 13 }}>{err}</span>}
    </div>
  );
}

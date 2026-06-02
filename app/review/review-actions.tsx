"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Candidate } from "../../lib/resolution";
import { Icon } from "../_components/icon";

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
    <div className="actions">
      {candidates.map((c) => (
        <button key={c.id} disabled={pending} onClick={() => act({ action: "link", propertyId: c.id })} className="btn ghost sm">
          <Icon name="link" size={15} />
          {c.name ?? "(unnamed)"} <span className="mono" style={{ color: "var(--ink-3)" }}>{(c.score * 100).toFixed(0)}%</span>
        </button>
      ))}
      <button disabled={pending} onClick={() => act({ action: "create" })} className="btn secondary sm">
        <Icon name="plus" size={15} />
        Create new
      </button>
      <button disabled={pending} onClick={() => act({ action: "dismiss" })} className="btn danger sm">
        <Icon name="x" size={15} />
        Dismiss
      </button>
      {err && <span className="form-msg err" style={{ fontSize: 13 }}>{err}</span>}
    </div>
  );
}

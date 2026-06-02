"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../_components/icon";

export function GeocodeButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    setBusy(true);
    setMsg(null);
    let remaining = 1;
    let guard = 0;
    try {
      while (remaining > 0 && guard < 12) {
        const res = await fetch("/api/geo/backfill", { method: "POST" });
        const d = await res.json();
        if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : "failed");
        remaining = d.remaining;
        setMsg(`${d.geocoded} placed · ${remaining} pending`);
        guard++;
        if (d.geocoded === 0) break; // no progress (done, or all failing) — stop
      }
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
      <button className="btn secondary sm" onClick={run} disabled={busy}>
        <Icon name="map-pin" size={15} />
        {busy ? "Geocoding…" : "Geocode pending"}
      </button>
      {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
    </span>
  );
}

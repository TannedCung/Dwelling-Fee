"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../_components/icon";
import { useToast } from "../_components/toast";

export function GeocodeButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null); // live progress (stays inline)
  const { notify } = useToast();
  const router = useRouter();

  async function run() {
    setBusy(true);
    setMsg(null);
    let remaining = 1;
    let placed = 0;
    let guard = 0;
    try {
      while (remaining > 0 && guard < 12) {
        const res = await fetch("/api/geo/backfill", { method: "POST" });
        const d = await res.json();
        if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : "failed");
        remaining = d.remaining;
        placed += d.geocoded;
        setMsg(`${d.geocoded} placed · ${remaining} pending`);
        guard++;
        if (d.geocoded === 0) break; // no progress (done, or all failing) — stop
      }
      router.refresh();
      notify({ type: "success", message: `Geocoded ${placed} propert${placed === 1 ? "y" : "ies"} · ${remaining} still pending.` });
    } catch (e) {
      setMsg(null);
      notify({ type: "error", message: e instanceof Error ? e.message : "Geocoding failed." });
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

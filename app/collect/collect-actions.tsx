"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../_components/icon";

/** Run a single source, or all enabled sources when no id is given. */
export function RunButton({ sourceId, label }: { sourceId?: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sourceId ? { sourceId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "failed");
      const runs: Array<{ signalsNew: number; signalsDuplicate: number; observationsCreated: number }> = data.runs ?? [];
      const novel = runs.reduce((a, r) => a + r.signalsNew, 0);
      const dup = runs.reduce((a, r) => a + r.signalsDuplicate, 0);
      const obs = runs.reduce((a, r) => a + r.observationsCreated, 0);
      setMsg(`${novel} new · ${dup} dup · ${obs} obs`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
      <button className={`btn ${sourceId ? "secondary sm" : "primary"}`} onClick={run} disabled={busy}>
        <Icon name={sourceId ? "play" : "rotate-cw"} size={15} />
        {busy ? "Running…" : label}
      </button>
      {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
    </span>
  );
}

export function EnableToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function toggle() {
    setBusy(true);
    try {
      await fetch("/api/collect/sources", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, enabled: !enabled }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className="btn ghost sm" onClick={toggle} disabled={busy} title={enabled ? "Disable" : "Enable"}>
      {enabled ? "Enabled" : "Disabled"}
    </button>
  );
}

export function AddSourceForm() {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/collect/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, url, kind: "stub" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "failed");
      setLabel("");
      setUrl("");
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: "1 1 180px" }}
          placeholder="Label (e.g. Batdongsan – Q9)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        <input
          className="input"
          style={{ flex: "2 1 260px" }}
          placeholder="https://source-url.example/listings"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button className="btn primary" disabled={busy || !label || !url}>
          <Icon name="plus" size={15} />
          {busy ? "Adding…" : "Add source"}
        </button>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>
        New sources use the <strong>stub</strong> fetcher (deterministic sample listings) until a real
        crawler is wired in.
      </span>
      {err && <p className="form-msg err">{err}</p>}
    </form>
  );
}

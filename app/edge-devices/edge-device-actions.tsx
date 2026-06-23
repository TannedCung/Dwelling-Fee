"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../_components/icon";
import { useToast } from "../_components/toast";

export function RegisterDeviceForm() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<{ deviceId: string; secret: string } | null>(null);
  const router = useRouter();
  const { notify } = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setCredential(null);
    try {
      const res = await fetch("/api/edge/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "could not register device");
      setCredential({ deviceId: data.deviceId, secret: data.secret });
      setName("");
      router.refresh();
      notify({ type: "success", message: "Edge device registered." });
    } catch (e2) {
      notify({ type: "error", message: e2 instanceof Error ? e2.message : "Could not register device." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: "1 1 240px" }}
          placeholder="Device name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn primary" disabled={busy || !name.trim()}>
          <Icon name="plus" size={15} />
          {busy ? "Registering..." : "Register device"}
        </button>
      </div>
      {credential && (
        <div className="notice" style={{ padding: 12 }}>
          <div className="card-title">One-time worker credentials</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Store this locally. The secret is not shown again.
          </div>
          <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>
{`EDGE_DEVICE_ID=${credential.deviceId}
EDGE_DEVICE_SECRET=${credential.secret}`}
          </pre>
        </div>
      )}
    </form>
  );
}

export function RevokeDeviceButton({ id, disabled }: { id: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { notify } = useToast();
  async function revoke() {
    setBusy(true);
    try {
      const res = await fetch(`/api/edge/devices/${id}/revoke`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "could not revoke device");
      router.refresh();
      notify({ type: "success", message: "Device revoked." });
    } catch (e) {
      notify({ type: "error", message: e instanceof Error ? e.message : "Could not revoke device." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className="btn ghost sm" onClick={revoke} disabled={busy || disabled}>
      <Icon name="x" size={14} />
      {busy ? "Revoking..." : "Revoke"}
    </button>
  );
}

export function EnqueueEdgeJobButton({ sourceId, label = "Queue edge crawl" }: { sourceId: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { notify } = useToast();
  async function enqueue() {
    setBusy(true);
    try {
      const res = await fetch("/api/edge/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "could not queue job");
      router.refresh();
      notify({ type: "success", message: `Queued edge job ${String(data.jobId).slice(0, 8)}.` });
    } catch (e) {
      notify({ type: "error", message: e instanceof Error ? e.message : "Could not queue edge job." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className="btn secondary sm" onClick={enqueue} disabled={busy}>
      <Icon name="monitor" size={15} />
      {busy ? "Queueing..." : label}
    </button>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../_components/icon";
import { useToast } from "../_components/toast";

export function EnableToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();
  const router = useRouter();
  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch("/api/collect/sources", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, enabled: !enabled }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(typeof d.error === "string" ? d.error : "failed");
      }
      router.refresh();
    } catch (e) {
      notify({ type: "error", message: e instanceof Error ? e.message : "Could not update source." });
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
  const [maxPages, setMaxPages] = useState(1);
  const [maxDepth, setMaxDepth] = useState(1);
  const [followLinks, setFollowLinks] = useState(false);
  const [itemSelector, setItemSelector] = useState("");
  const [contentSelector, setContentSelector] = useState("");
  const [linkSelector, setLinkSelector] = useState("");
  const [minItems, setMinItems] = useState(1);
  const [solveTimeoutSeconds, setSolveTimeoutSeconds] = useState(900);
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/collect/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label,
          url,
          kind: "http",
          config: {
            maxPages,
            maxDepth,
            followLinks,
            itemSelector: itemSelector || undefined,
            contentSelector: contentSelector || undefined,
            linkSelector: linkSelector || undefined,
            minItems,
            solveTimeoutMs: solveTimeoutSeconds * 1000,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "failed");
      setLabel("");
      setUrl("");
      setMaxPages(1);
      setMaxDepth(1);
      setFollowLinks(false);
      setItemSelector("");
      setContentSelector("");
      setLinkSelector("");
      setMinItems(1);
      setSolveTimeoutSeconds(900);
      router.refresh();
      notify({ type: "success", message: "Source added." });
    } catch (e2) {
      notify({ type: "error", message: e2 instanceof Error ? e2.message : "Could not add source." });
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
          placeholder="Label (e.g. Batdongsan Ecopark)"
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
        <input
          className="input"
          type="number"
          min={1}
          max={10}
          style={{ flex: "0 0 110px" }}
          title="Max pages"
          value={maxPages}
          onChange={(e) => setMaxPages(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
        />
        <input
          className="input"
          type="number"
          min={0}
          max={5}
          style={{ flex: "0 0 110px" }}
          title="Max depth"
          value={maxDepth}
          onChange={(e) => setMaxDepth(Math.max(0, Math.min(5, Number(e.target.value) || 0)))}
        />
        <input
          className="input"
          type="number"
          min={1}
          max={50}
          style={{ flex: "0 0 110px" }}
          title="Minimum items"
          value={minItems}
          onChange={(e) => setMinItems(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
        />
        <input
          className="input"
          type="number"
          min={60}
          max={3600}
          step={60}
          style={{ flex: "0 0 130px" }}
          title="Human solve window in seconds"
          value={solveTimeoutSeconds}
          onChange={(e) => setSolveTimeoutSeconds(Math.max(60, Math.min(3600, Number(e.target.value) || 900)))}
        />
        <label className="chip" style={{ cursor: "pointer", height: 38 }}>
          <input
            type="checkbox"
            checked={followLinks}
            onChange={(e) => setFollowLinks(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          follow links
        </label>
        <input
          className="input"
          style={{ flex: "1 1 180px" }}
          placeholder="Item selector (optional)"
          value={itemSelector}
          onChange={(e) => setItemSelector(e.target.value)}
        />
        <input
          className="input"
          style={{ flex: "1 1 180px" }}
          placeholder="Content selector (optional)"
          value={contentSelector}
          onChange={(e) => setContentSelector(e.target.value)}
        />
        <input
          className="input"
          style={{ flex: "1 1 180px" }}
          placeholder="Link selector (optional)"
          value={linkSelector}
          onChange={(e) => setLinkSelector(e.target.value)}
        />
        <button className="btn primary" disabled={busy || !label || !url}>
          <Icon name="plus" size={15} />
          {busy ? "Adding..." : "Add source"}
        </button>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>
        Sources are collected by registered edge devices. The server stores queue state and ingests
        deduplicated, distilled posts after workers submit results.
      </span>
    </form>
  );
}

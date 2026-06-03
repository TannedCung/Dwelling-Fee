"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../_components/icon";
import { useToast } from "../_components/toast";

/** Run a single source, or all enabled sources when no id is given. */
export function RunButton({ sourceId, label }: { sourceId?: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null); // last-run summary (stays inline)
  const { notify } = useToast();
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
      const runs: Array<{
        status: string;
        pagesFetched: number;
        pagesSkippedUnchanged: number;
        pagesFailed: number;
        itemsFetched: number;
        signalsNew: number;
        signalsDuplicate: number;
        observationsCreated: number;
      }> = data.runs ?? [];
      const novel = runs.reduce((a, r) => a + r.signalsNew, 0);
      const dup = runs.reduce((a, r) => a + r.signalsDuplicate, 0);
      const obs = runs.reduce((a, r) => a + r.observationsCreated, 0);
      const pages = runs.reduce((a, r) => a + r.pagesFetched, 0);
      const skipped = runs.reduce((a, r) => a + r.pagesSkippedUnchanged, 0);
      const items = runs.reduce((a, r) => a + r.itemsFetched, 0);
      const failed = runs.filter((r) => r.status === "error").length;
      setMsg(`${pages} pages · ${skipped} unchanged · ${items} items · ${novel} new · ${dup} dup · ${obs} obs`);
      router.refresh();
      if (failed > 0) notify({ type: "error", message: `${failed} of ${runs.length} source(s) failed to collect.` });
      else notify({ type: "success", message: `Collected: ${novel} new, ${dup} duplicate, ${obs} observation(s).` });
    } catch (e) {
      notify({ type: "error", message: e instanceof Error ? e.message : "Collection failed." });
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

export function PreviewButton({ sourceId }: { sourceId: string }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ pages: number; items: Array<{ sourceRef: string; text: string }> } | null>(null);
  const { notify } = useToast();

  async function runPreview() {
    setBusy(true);
    setPreview(null);
    try {
      const res = await fetch("/api/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId, preview: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "preview failed");
      const items: Array<{ sourceRef: string; text: string }> = data.items ?? [];
      setPreview({ pages: Array.isArray(data.pages) ? data.pages.length : 0, items });
      notify({ type: "success", message: `Preview found ${items.length} item(s).` });
    } catch (e) {
      notify({ type: "error", message: e instanceof Error ? e.message : "Preview failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <button className="btn secondary sm" onClick={runPreview} disabled={busy} title="Preview extracted items without ingesting">
        <Icon name="search" size={15} />
        {busy ? "Previewing..." : "Preview"}
      </button>
      {preview && (
        <div className="notice" style={{ padding: 10 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {preview.pages} page{preview.pages === 1 ? "" : "s"} checked · {preview.items.length} item
            {preview.items.length === 1 ? "" : "s"}
          </div>
          {preview.items.slice(0, 3).map((item) => (
            <div key={item.sourceRef} className="mono" style={{ fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap" }}>
              {item.sourceRef}
              {"\n"}
              {item.text.slice(0, 500)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [maxConcurrency, setMaxConcurrency] = useState(2);
  const [followLinks, setFollowLinks] = useState(false);
  const [useSitemaps, setUseSitemaps] = useState(false);
  const [itemSelector, setItemSelector] = useState("");
  const [contentSelector, setContentSelector] = useState("");
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
            maxConcurrency,
            followLinks,
            useSitemaps,
            itemSelector: itemSelector || undefined,
            contentSelector: contentSelector || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "failed");
      setLabel("");
      setUrl("");
      setMaxPages(1);
      setMaxDepth(1);
      setMaxConcurrency(2);
      setFollowLinks(false);
      setUseSitemaps(false);
      setItemSelector("");
      setContentSelector("");
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
          max={5}
          style={{ flex: "0 0 110px" }}
          title="Concurrency"
          value={maxConcurrency}
          onChange={(e) => setMaxConcurrency(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
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
        <label className="chip" style={{ cursor: "pointer", height: 38 }}>
          <input
            type="checkbox"
            checked={useSitemaps}
            onChange={(e) => setUseSitemaps(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          sitemaps
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
        <button className="btn primary" disabled={busy || !label || !url}>
          <Icon name="plus" size={15} />
          {busy ? "Adding…" : "Add source"}
        </button>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>
        HTTP sources respect robots.txt, stay on the source domain, cache unchanged pages, and use
        selectors only when a page needs tighter extraction.
      </span>
    </form>
  );
}

"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { PropertyExtraction } from "../../../lib/extraction/schema";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface CommitSummary {
  observationsCreated: number;
  autoLinked: number;
  created: number;
  needsReview: number;
}

const vnd = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n) + " ₫";

export function IngestChat({
  sessionId,
  status,
  initialMessages,
  initialDraft,
}: {
  sessionId: string;
  status: "open" | "committed" | "abandoned";
  initialMessages: ChatMessage[];
  initialDraft: PropertyExtraction[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState<PropertyExtraction[]>(initialDraft);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [readyToCommit, setReadyToCommit] = useState(false);
  const [committed, setCommitted] = useState(status === "committed");
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, sending]);

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    setErr(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content }]);
    setSending(true);
    try {
      const res = await fetch(`/api/ingest/session/${sessionId}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "turn failed");
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      setDraft(data.draft);
      setReadyToCommit(Boolean(data.readyToCommit));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setSending(false);
    }
  }

  async function commit() {
    if (committing || draft.length === 0) return;
    setErr(null);
    setCommitting(true);
    try {
      const res = await fetch(`/api/ingest/session/${sessionId}/commit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "commit failed");
      setSummary(data);
      setCommitted(true);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,360px)", gap: 20, alignItems: "start" }}>
      {/* Conversation */}
      <section style={{ display: "grid", gap: 12, minWidth: 0 }}>
        <div style={{ display: "grid", gap: 10, maxHeight: 460, overflowY: "auto", padding: 4 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ justifySelf: m.role === "user" ? "end" : "start", maxWidth: "85%" }}>
              <div
                style={{
                  background: m.role === "user" ? "#2563eb" : "#f1f3f5",
                  color: m.role === "user" ? "#fff" : "#111",
                  padding: "8px 12px",
                  borderRadius: 12,
                  whiteSpace: "pre-wrap",
                  fontSize: 14,
                }}
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && <div style={{ color: "#888", fontSize: 13 }}>Assistant is thinking…</div>}
          <div ref={endRef} />
        </div>

        {!committed && (
          <div style={{ display: "grid", gap: 8 }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              placeholder="Paste a broker message, or refine the draft… (⌘/Ctrl+Enter to send)"
              rows={3}
              style={{ width: "100%", padding: 10, fontFamily: "inherit", fontSize: 14 }}
            />
            <button onClick={send} disabled={sending || input.trim().length === 0} style={{ padding: "8px 16px", cursor: "pointer", justifySelf: "start" }}>
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        )}
        {err && <p style={{ color: "#b00", fontSize: 13 }}>{err}</p>}
      </section>

      {/* Draft panel */}
      <aside style={{ border: "1px solid #eee", borderRadius: 10, padding: 14, display: "grid", gap: 10, position: "sticky", top: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong style={{ fontSize: 14 }}>Draft</strong>
          <span style={{ fontSize: 12, color: "#888" }}>{draft.length} propert{draft.length === 1 ? "y" : "ies"}</span>
        </div>

        {draft.length === 0 ? (
          <p style={{ color: "#999", fontSize: 13, margin: 0 }}>Nothing yet. Paste a message to start.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {draft.map((p, i) => (
              <li key={i} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 10, fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>{p.name ?? "(unnamed)"}</div>
                <div style={{ color: "#555" }}>
                  {p.type} · {p.listingType} · {vnd(p.priceVnd)}
                  {p.priceBasis === "per_m2" && "/m²"}
                  {p.areaM2 != null && ` · ${p.areaM2} m²`}
                  {p.bedrooms != null && ` · ${p.bedrooms}BR`}
                  {p.isNegotiable && " · TL"}
                </div>
                <div style={{ color: "#aaa", fontSize: 11 }}>
                  {p.dealStatus} · conf {(p.confidence * 100).toFixed(0)}%
                  {p.locationText && ` · ${p.locationText}`}
                </div>
              </li>
            ))}
          </ul>
        )}

        {committed ? (
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ color: "#137333", fontSize: 13, fontWeight: 600 }}>✓ Committed</div>
            {summary && (
              <div style={{ fontSize: 12, color: "#555" }}>
                {summary.observationsCreated} obs · {summary.autoLinked} linked · {summary.created} new · {summary.needsReview} to review
              </div>
            )}
            <a href="/properties" style={{ fontSize: 13 }}>View properties →</a>
            <a href="/" style={{ fontSize: 13 }}>Back to sessions</a>
          </div>
        ) : (
          <button
            onClick={commit}
            disabled={committing || draft.length === 0}
            style={{
              padding: "8px 16px",
              cursor: draft.length === 0 ? "not-allowed" : "pointer",
              background: readyToCommit ? "#137333" : "#e9ecef",
              color: readyToCommit ? "#fff" : "#333",
              border: "none",
              borderRadius: 6,
              fontWeight: 600,
            }}
          >
            {committing ? "Committing…" : "Commit draft"}
          </button>
        )}
      </aside>
    </div>
  );
}

"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { PropertyExtraction } from "../../../lib/extraction/schema";
import { missingFields, draftReady } from "../../../lib/extraction/completeness";
import { Icon } from "../../_components/icon";

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
  const [committed, setCommitted] = useState(status === "committed");
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, sending]);

  const ready = draftReady(draft);
  const incompleteCount = draft.filter((p) => missingFields(p).length > 0).length;

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
    <div className="chat-grid">
      {/* Conversation */}
      <section className="stack" style={{ minWidth: 0 }}>
        <div className="chat-log">
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.content}
            </div>
          ))}
          {sending && <div className="muted">Assistant is thinking…</div>}
          <div ref={endRef} />
        </div>

        {!committed && (
          <div className="stack" style={{ gap: 10 }}>
            <textarea
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              placeholder="Paste a broker message, or refine the draft… (⌘/Ctrl+Enter to send)"
              rows={3}
            />
            <button onClick={send} disabled={sending || input.trim().length === 0} className="btn primary" style={{ justifySelf: "start" }}>
              <Icon name="send" size={16} />
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        )}
        {err && <p className="form-msg err">{err}</p>}
      </section>

      {/* Draft panel */}
      <aside className="card draft-panel">
        <div className="card-row" style={{ alignItems: "baseline" }}>
          <strong className="card-title" style={{ fontSize: 15 }}>Draft</strong>
          <span className="muted">{draft.length} propert{draft.length === 1 ? "y" : "ies"}</span>
        </div>

        {draft.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing yet. Paste a message to start.</p>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {draft.map((p, i) => (
              <div key={i} className="draft-item">
                <div className="dt">{p.name ?? "(unnamed)"}</div>
                <div className="dmeta">
                  {p.type} · {p.listingType} · {vnd(p.priceVnd)}
                  {p.priceBasis === "per_m2" && "/m²"}
                  {p.areaM2 != null && ` · ${p.areaM2} m²`}
                  {p.bedrooms != null && ` · ${p.bedrooms}BR`}
                  {p.isNegotiable && " · TL"}
                </div>
                <div className="dsub">
                  {p.dealStatus} · conf {(p.confidence * 100).toFixed(0)}%
                  {p.locationText && ` · ${p.locationText}`}
                </div>
                {missingFields(p).length > 0 ? (
                  <div className="draft-flag needs">
                    <Icon name="triangle-alert" size={13} /> needs: {missingFields(p).join(", ")}
                  </div>
                ) : (
                  <div className="draft-flag ok">
                    <Icon name="check-circle" size={13} /> complete
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {committed ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="form-msg ok" style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="check-circle" size={16} /> Committed
            </div>
            {summary && (
              <div className="muted">
                {summary.observationsCreated} obs · {summary.autoLinked} linked · {summary.created} new · {summary.needsReview} to review
              </div>
            )}
            <a href="/properties" className="form-msg">View properties →</a>
            <a href="/" className="form-msg">Back to sessions</a>
          </div>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            <button
              onClick={commit}
              disabled={committing || !ready}
              title={ready ? "" : "Fill in the required fields first"}
              className="btn secondary"
            >
              {committing ? "Committing…" : "Commit draft"}
            </button>
            {!ready && draft.length > 0 && (
              <span className="form-msg err" style={{ fontSize: 12 }}>
                {incompleteCount} propert{incompleteCount === 1 ? "y" : "ies"} still missing required info.
              </span>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

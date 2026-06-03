"use client";

import { useState, useRef, useEffect } from "react";
import type { PropertyExtraction } from "../../../lib/extraction/schema";
import { missingFields, draftReady } from "../../../lib/extraction/completeness";
import { Icon } from "../../_components/icon";
import { useToast } from "../../_components/toast";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type TurnEvent =
  | { type: "partial"; reply: string; draft: unknown }
  | { type: "done"; result: { reply: string; draft: PropertyExtraction[]; readyToCommit: boolean } }
  | { type: "error"; error: string };

/** Read a `text/event-stream` body and yield each parsed `data:` JSON payload. */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<TurnEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(5).trim()) as TurnEvent;
      } catch {
        /* ignore malformed frame */
      }
    }
  }
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
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(status === "committed");
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const { notify } = useToast();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => endRef.current?.scrollIntoView({ behavior: "smooth" }),
    [messages, sending, streamingReply],
  );

  const ready = draftReady(draft);
  const incompleteCount = draft.filter((p) => missingFields(p).length > 0).length;

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content }]);
    setSending(true);
    setStreamingReply(""); // show the assistant bubble immediately, fill as it streams
    try {
      const res = await fetch(`/api/ingest/session/${sessionId}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok || !res.body) {
        // Pre-stream error: server replied with JSON, not an event stream.
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "turn failed");
      }
      if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
        // A 200 that isn't an event stream means we were redirected away (e.g.
        // to the sign-in page after the session lapsed). Surface it instead of
        // silently leaving the assistant bubble stuck on the typing indicator.
        throw new Error("Your session may have expired — please refresh and sign in again.");
      }

      let lastReply = "";
      let committedTurn = false;
      for await (const event of readSse(res.body)) {
        if (event.type === "partial") {
          lastReply = event.reply;
          setStreamingReply(event.reply);
        } else if (event.type === "done") {
          committedTurn = true;
          setMessages((m) => [...m, { role: "assistant", content: event.result.reply }]);
          setDraft(event.result.draft);
          setStreamingReply(null);
        } else if (event.type === "error") {
          throw new Error(event.error);
        }
      }
      // Stream ended without a `done` (e.g. dropped connection) — keep what we have.
      if (!committedTurn) {
        if (lastReply) setMessages((m) => [...m, { role: "assistant", content: lastReply }]);
        setStreamingReply(null);
      }
    } catch (e) {
      notify({ type: "error", message: e instanceof Error ? e.message : "Message failed to send." });
      setStreamingReply(null);
    } finally {
      setSending(false);
    }
  }

  async function commit() {
    if (committing || draft.length === 0) return;
    setCommitting(true);
    try {
      const res = await fetch(`/api/ingest/session/${sessionId}/commit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "commit failed");
      setSummary(data);
      setCommitted(true);
      notify({ type: "success", message: `Committed — ${data.observationsCreated} observation(s) saved.` });
      // Don't router.refresh() here: it would remount this component and wipe the
      // just-computed summary. The session is now read-only and the panel below is
      // self-sufficient; the sessions list re-fetches when the user navigates back.
    } catch (e) {
      notify({ type: "error", message: e instanceof Error ? e.message : "Commit failed." });
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
          {streamingReply !== null && (
            <div className="bubble assistant" aria-live="polite" data-testid="streaming-bubble">
              {streamingReply || <span className="typing-dots"><span /><span /><span /></span>}
            </div>
          )}
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

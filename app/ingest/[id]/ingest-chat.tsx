"use client";

import { useState, useRef, useEffect } from "react";
import type { PropertyExtraction } from "../../../lib/extraction/schema";
import { missingFields, draftReady } from "../../../lib/extraction/completeness";
import { Icon } from "../../_components/icon";
import { useToast } from "../../_components/toast";

interface ChatAttachment {
  filename: string;
  url?: string;
  contentType?: string;
  size?: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
  createdAt?: string;
}

type TurnEvent =
  | { type: "partial"; reply: string; draft: unknown }
  | { type: "done"; result: { reply: string; draft: PropertyExtraction[]; readyToCommit: boolean } }
  | { type: "error"; error: string };

async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<TurnEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parseBlock = (block: string): TurnEvent | null => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) return null;
    try {
      return JSON.parse(data) as TurnEvent;
    } catch {
      return null;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = parseBlock(block);
      if (event) yield event;
    }
  }
  buffer += decoder.decode();
  const event = parseBlock(buffer);
  if (event) yield event;
}

interface CommitSummary {
  observationsCreated: number;
  autoLinked: number;
  created: number;
  needsReview: number;
}

const EXAMPLES = [
  "Căn 2PN Eco Green, 71m², chào 4.8 tỷ, block HR2",
  "Nhà phố ABC, 1 trệt 2 lầu, đã chốt 9.2 tỷ",
  "Ảnh bảng giá dự án: trích căn, tầng, diện tích và giá",
];

const vnd = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n) + " ₫";

const timeLabel = (value?: string) =>
  value ? new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";

const dayLabel = (value?: string) =>
  value ? new Date(value).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "today";

export function IngestChat({
  sessionId,
  status,
  sourceType,
  title,
  initialMessages,
  initialDraft,
}: {
  sessionId: string;
  status: "open" | "committed" | "abandoned";
  sourceType: string;
  title: string | null;
  initialMessages: ChatMessage[];
  initialDraft: PropertyExtraction[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState<PropertyExtraction[]>(initialDraft);
  const [input, setInput] = useState("");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(status === "committed");
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const { notify } = useToast();
  const logRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, sending, streamingReply]);

  const closed = committed || status === "abandoned";
  const ready = draftReady(draft);
  const incompleteCount = draft.filter((p) => missingFields(p).length > 0).length;
  const completeCount = Math.max(0, draft.length - incompleteCount);
  const progress = draft.length === 0 ? 0 : Math.round((completeCount / draft.length) * 100);
  const userMessageCount = messages.filter((m) => m.role === "user").length;

  async function send() {
    const content = input.trim();
    const images = selectedImages;
    if ((!content && images.length === 0) || sending) return;
    const createdAt = new Date().toISOString();
    setInput("");
    setSelectedImages([]);
    if (fileRef.current) fileRef.current.value = "";
    setMessages((m) => [...m, {
      role: "user",
      content,
      createdAt,
      attachments: images.map((file) => ({ filename: file.name, contentType: file.type, size: file.size })),
    }]);
    setSending(true);
    setStreamingReply("");
    try {
      const body = new FormData();
      body.set("content", content);
      for (const image of images) body.append("images", image);
      const res = await fetch(`/api/ingest/session/${sessionId}/message`, {
        method: "POST",
        ...(images.length > 0
          ? { body }
          : { headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "turn failed");
      }
      if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
        throw new Error("Your session may have expired — please refresh and sign in again.");
      }

      let lastReply = "";
      let committedTurn = false;
      for await (const event of readSse(res.body)) {
        if (event.type === "partial") {
          if (event.reply) lastReply = event.reply;
          setStreamingReply(event.reply);
        } else if (event.type === "done") {
          committedTurn = true;
          const reply = event.result.reply || lastReply || "Draft updated.";
          setMessages((m) => [...m, { role: "assistant", content: reply, createdAt: new Date().toISOString() }]);
          setDraft(event.result.draft);
          setStreamingReply(null);
        } else if (event.type === "error") {
          throw new Error(event.error);
        }
      }
      if (!committedTurn) {
        if (lastReply) setMessages((m) => [...m, { role: "assistant", content: lastReply, createdAt: new Date().toISOString() }]);
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
    } catch (e) {
      notify({ type: "error", message: e instanceof Error ? e.message : "Commit failed." });
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="chat-grid">
      <section className="chat-panel">
        <div className="chat-topbar">
          <div className="icon-btn" aria-hidden="true">
            <Icon name="panel-left" size={18} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="ct-title">
              <Icon name="file-text" size={16} style={{ color: "var(--clay)" }} />
              {title ?? "New ingest session"}
            </div>
            <div className="ct-meta">
              <span>{sourceType}</span><span className="sep" />
              <span>{userMessageCount} message{userMessageCount === 1 ? "" : "s"}</span><span className="sep" />
              <span>{draft.length} propert{draft.length === 1 ? "y" : "ies"} in draft</span>
            </div>
          </div>
          <span className={`badge ${committed ? "committed" : status}`}>
            <span className="dot" style={{ background: "currentColor" }} />
            {committed ? "committed" : status}
          </span>
        </div>

        <div className="chat-log" ref={logRef}>
          {messages.length === 0 ? (
            <div className="chat-empty">
              <div className="ce-mark">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-mark.svg" alt="" />
              </div>
              <h3>Start a collection session</h3>
              <p>Paste a broker message, listing, or screenshot. The assistant will extract observations and keep a structured draft here.</p>
            </div>
          ) : (
            <div className="day-sep">{dayLabel(messages[0]?.createdAt)}</div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="avatar">
                {m.role === "assistant" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/logo-mark.svg" alt="" />
                ) : "You"}
              </div>
              <div className="bubble-wrap">
                <div className={`bubble ${m.role}`}>
                  {m.content || (m.attachments?.length ? "Image attachment" : "")}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="attachment-list">
                      {m.attachments.map((a, j) => (
                        <a key={j} href={a.url} target="_blank" rel="noreferrer" className="attachment-chip">
                          <Icon name="image" size={13} />
                          {a.filename}
                        </a>
                      ))}
                    </div>
                  )}
                  {m.role === "assistant" && draft.length > 0 && i === messages.length - 1 && (
                    <span className="extracted-line"><Icon name="sparkles" size={13} />draft updated</span>
                  )}
                </div>
                <span className="time">{timeLabel(m.createdAt)}</span>
              </div>
            </div>
          ))}

          {streamingReply !== null && (
            <div className="msg assistant" aria-live="polite" data-testid="streaming-bubble">
              <div className="avatar">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-mark.svg" alt="" />
              </div>
              <div className="bubble-wrap">
                <div className="bubble assistant">
                  {streamingReply || <span className="typing-dots"><span /><span /><span /></span>}
                </div>
              </div>
            </div>
          )}
        </div>

        {closed ? (
          <div className="composer-locked">
            <Icon name={committed ? "check-circle" : "x"} size={15} />
            {committed ? "Session committed — read only." : "Session abandoned — read only."}
          </div>
        ) : (
          <div className="composer">
            <div className="examples">
              <span className="lbl">Examples:</span>
              {EXAMPLES.map((example) => (
                <button key={example} type="button" className="ex-chip" title={example} onClick={() => setInput(example)} disabled={sending}>
                  <Icon name="plus" size={12} />
                  {example}
                </button>
              ))}
            </div>
            <div className="composer-field">
              <textarea
                className="input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                }}
                placeholder="Paste a broker message, or refine the draft..."
                rows={2}
              />
              <button
                type="button"
                className="composer-send"
                onClick={send}
                disabled={sending || (input.trim().length === 0 && selectedImages.length === 0)}
                aria-label="Send"
              >
                <Icon name="send" size={17} />
              </button>
            </div>
            {selectedImages.length > 0 && (
              <div className="attachment-list composer">
                {selectedImages.map((file, i) => (
                  <button
                    key={`${file.name}-${i}`}
                    type="button"
                    className="attachment-chip removable"
                    onClick={() => setSelectedImages((files) => files.filter((_, j) => j !== i))}
                  >
                    <Icon name="image" size={13} />
                    {file.name}
                    <Icon name="x" size={13} />
                  </button>
                ))}
              </div>
            )}
            <div className="hint">
              <span>Raw text and images are preserved as provenance.</span>
              <span><kbd>Ctrl</kbd> <kbd>Enter</kbd> to send</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => setSelectedImages(Array.from(e.currentTarget.files ?? []))}
            />
            <div className="composer-actions">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={sending} className="btn secondary sm">
                <Icon name="image" size={16} />
                Images
              </button>
              <span className="muted">Attach screenshots or bảng giá as a list.</span>
            </div>
          </div>
        )}
      </section>

      <aside className="draft-panel">
        <div className="draft-card">
          <div className="draft-head">
            <div className="dh-top">
              <strong>Draft</strong>
              <span className="muted">{draft.length} propert{draft.length === 1 ? "y" : "ies"}</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-label">
              <span>{completeCount}/{draft.length || 0} complete</span>
              <span className={ready ? "ok" : undefined}>
                {ready ? <><Icon name="check-circle" size={13} />ready to commit</> : "needs required fields"}
              </span>
            </div>
          </div>

          {draft.length === 0 ? (
            <p className="muted" style={{ margin: "0 16px 16px" }}>Nothing yet. Paste a message to start.</p>
          ) : (
            <div className="draft-items">
              {draft.map((p, i) => {
                const missing = missingFields(p);
                const itemTitle = [p.projectName, p.buildingName, p.houseNumber].filter(Boolean).join(" / ") || p.name || "(unnamed)";
                return (
                  <div key={i} className="draft-item">
                    <div className="di-top">
                      <div className="di-ico">
                        <Icon name={p.type === "house" ? "home" : p.type === "land" ? "layers" : "building-2"} size={17} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="di-name">{itemTitle}</div>
                        <div className="di-loc"><Icon name="map-pin" size={12} />{p.locationText || "No location text"}</div>
                      </div>
                    </div>
                    <div className="di-fields">
                      <span className="di-field">{p.type}</span>
                      <span className="di-field">{p.listingType}</span>
                      <span className="di-field">{p.dealStatus}</span>
                      <span className={`di-field ${p.priceVnd == null ? "missing" : "price"}`}>
                        {vnd(p.priceVnd)}{p.priceBasis === "per_m2" && "/m²"}
                      </span>
                      <span className={`di-field ${p.areaM2 == null ? "missing" : ""}`}>{p.areaM2 == null ? "missing area" : `${p.areaM2} m²`}</span>
                      {p.bedrooms != null && <span className="di-field">{p.bedrooms}BR</span>}
                      {p.isNegotiable && <span className="di-field">negotiable</span>}
                    </div>
                    <div className="di-conf">
                      <span>conf</span>
                      <span className="conf-meter"><i style={{ width: `${Math.round(p.confidence * 100)}%` }} /></span>
                      <span>{(p.confidence * 100).toFixed(0)}%</span>
                    </div>
                    {missing.length > 0 ? (
                      <div className="di-flag needs"><Icon name="triangle-alert" size={13} />needs: {missing.join(", ")}</div>
                    ) : (
                      <div className="di-flag ok"><Icon name="check-circle" size={13} />complete</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="commit-zone">
            {committed ? (
              <div className="commit-summary">
                <div className="cs-head"><Icon name="check-circle" size={18} />Committed</div>
                {summary && (
                  <div className="cs-grid">
                    <div className="cs-stat"><b>{summary.observationsCreated}</b><span>observations</span></div>
                    <div className="cs-stat"><b>{summary.autoLinked}</b><span>auto-linked</span></div>
                    <div className="cs-stat"><b>{summary.created}</b><span>created</span></div>
                    <div className="cs-stat"><b>{summary.needsReview}</b><span>to review</span></div>
                  </div>
                )}
                <a href="/properties" className="btn secondary block">View properties</a>
              </div>
            ) : status === "abandoned" ? (
              <span className="muted" style={{ textAlign: "center", fontSize: 13 }}>Session abandoned — draft cannot be committed.</span>
            ) : (
              <>
                <button
                  onClick={commit}
                  disabled={committing || !ready}
                  title={ready ? "" : "Fill in the required fields first"}
                  className="btn secondary block"
                >
                  <Icon name="git-merge" size={16} />
                  {committing ? "Committing..." : "Commit draft"}
                </button>
                {!ready && draft.length > 0 && (
                  <span className="form-msg err" style={{ fontSize: 12, textAlign: "center" }}>
                    {incompleteCount} propert{incompleteCount === 1 ? "y" : "ies"} still missing required info.
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

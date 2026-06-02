"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function PasteForm() {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  async function submit() {
    setMsg(null);
    const res = await fetch("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rawText: text, sourceType: "broker" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(`Error: ${typeof data.error === "string" ? data.error : "ingest failed"}`);
      return;
    }
    setMsg(
      data.duplicate
        ? "Already ingested (duplicate)."
        : `Ingested ${data.observationsCreated} observation(s): ${data.autoLinked} linked, ${data.created} new, ${data.needsReview} to review.`,
    );
    setText("");
    start(() => router.refresh());
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste a broker message…  e.g. Bán căn 2PN Vinhomes Q9, 60m2, 3.2 tỷ, sổ hồng. TL."
        rows={5}
        style={{ width: "100%", padding: 10, fontFamily: "inherit", fontSize: 14 }}
      />
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={() => start(submit)}
          disabled={pending || text.trim().length === 0}
          style={{ padding: "8px 16px", cursor: "pointer" }}
        >
          {pending ? "Extracting…" : "Ingest & extract"}
        </button>
        {msg && <span style={{ fontSize: 14, color: "#555" }}>{msg}</span>}
      </div>
    </div>
  );
}

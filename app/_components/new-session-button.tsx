"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icon";
import { useToast } from "./toast";

export function NewSessionButton() {
  const [pending, start] = useTransition();
  const { notify } = useToast();
  const router = useRouter();

  function create() {
    start(async () => {
      try {
        const res = await fetch("/api/ingest/session", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.id) {
          router.push(`/ingest/${data.id}`);
          return;
        }
        throw new Error(typeof data.error === "string" ? data.error : "could not start a session");
      } catch (e) {
        notify({ type: "error", message: e instanceof Error ? e.message : "Could not start a session." });
      }
    });
  }

  return (
    <button onClick={create} disabled={pending} className="btn primary">
      <Icon name="plus" size={16} />
      {pending ? "Starting…" : "New ingest session"}
    </button>
  );
}

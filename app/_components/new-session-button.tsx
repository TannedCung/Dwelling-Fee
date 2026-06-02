"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icon";

export function NewSessionButton() {
  const [pending, start] = useTransition();
  const router = useRouter();

  function create() {
    start(async () => {
      const res = await fetch("/api/ingest/session", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.id) router.push(`/ingest/${data.id}`);
    });
  }

  return (
    <button onClick={create} disabled={pending} className="btn primary">
      <Icon name="plus" size={16} />
      {pending ? "Starting…" : "New ingest session"}
    </button>
  );
}

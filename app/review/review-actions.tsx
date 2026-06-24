"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReviewCreateSuggestion } from "../../lib/review";
import type { Candidate } from "../../lib/resolution";
import { Icon } from "../_components/icon";
import { useToast } from "../_components/toast";

const DONE_MESSAGE: Record<string, string> = {
  link: "Linked to property.",
  create: "New property created.",
  dismiss: "Observation dismissed.",
};

function candidateTitle(c: Candidate): string {
  return [c.projectName, c.buildingName, c.houseNumber].filter(Boolean).join(" / ")
    || c.name
    || "(unnamed)";
}

export function ReviewActions({
  observationId,
  candidates,
  createSuggestion,
}: {
  observationId: string;
  candidates: Candidate[];
  createSuggestion: ReviewCreateSuggestion;
}) {
  const [pending, start] = useTransition();
  const { notify } = useToast();
  const router = useRouter();

  function act(body: {
    action: "link" | "create" | "dismiss";
    propertyId?: string;
    projectName?: string | null;
    buildingName?: string | null;
    houseNumber?: string | null;
  }) {
    start(async () => {
      const res = await fetch(`/api/review/${observationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        notify({ type: "error", message: typeof d.error === "string" ? d.error : "Review action failed." });
        return;
      }
      notify({ type: "success", message: DONE_MESSAGE[body.action] ?? "Done." });
      router.refresh();
    });
  }

  return (
    <div className="actions">
      {candidates.map((c) => (
        <button key={c.id} disabled={pending} onClick={() => act({ action: "link", propertyId: c.id })} className="btn ghost sm">
          <Icon name="link" size={15} />
          {candidateTitle(c)} <span className="mono" style={{ color: "var(--ink-3)" }}>{(c.score * 100).toFixed(0)}%</span>
        </button>
      ))}
      <button
        disabled={pending}
        onClick={() => act({ action: "create", ...createSuggestion })}
        className="btn secondary sm review-create"
      >
        <Icon name="plus" size={15} />
        Create {createSuggestion.label}
      </button>
      <button disabled={pending} onClick={() => act({ action: "dismiss" })} className="btn danger sm">
        <Icon name="x" size={15} />
        Dismiss
      </button>
    </div>
  );
}

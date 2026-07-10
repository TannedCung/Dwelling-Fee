"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReviewCreateSuggestion, ReviewHierarchyOptions } from "../../lib/review";
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

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLocaleLowerCase("vi-VN") === (b ?? "").trim().toLocaleLowerCase("vi-VN");
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function ReviewActions({
  observationId,
  candidates,
  createSuggestion,
  hierarchyOptions,
}: {
  observationId: string;
  candidates: Candidate[];
  createSuggestion: ReviewCreateSuggestion;
  hierarchyOptions: ReviewHierarchyOptions;
}) {
  const [pending, start] = useTransition();
  const [projectName, setProjectName] = useState(createSuggestion.projectName ?? "");
  const [buildingName, setBuildingName] = useState(createSuggestion.buildingName ?? "");
  const [houseNumber, setHouseNumber] = useState(createSuggestion.houseNumber ?? "");
  const { notify } = useToast();
  const router = useRouter();

  const selectedProject = useMemo(
    () => hierarchyOptions.projects.find((project) => sameName(project.name, projectName)) ?? null,
    [hierarchyOptions.projects, projectName],
  );
  const buildingOptions = selectedProject
    ? hierarchyOptions.buildings.filter((building) => building.projectId === selectedProject.id)
    : hierarchyOptions.buildings;
  const selectedBuilding = buildingOptions.find((building) => sameName(building.name, buildingName)) ?? null;
  const createLabel = [projectName, buildingName, houseNumber].map(nullableText).filter(Boolean).join(" / ")
    || createSuggestion.label;

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
    <>
      <div className="review-hierarchy review-hierarchy-edit">
        <label className="review-kv">
          <span>Project</span>
          <select
            className="input"
            value={selectedProject?.id ?? ""}
            disabled={pending || hierarchyOptions.projects.length === 0}
            onChange={(e) => {
              const next = hierarchyOptions.projects.find((project) => project.id === e.target.value);
              setProjectName(next?.name ?? "");
              setBuildingName("");
            }}
          >
            <option value="">Custom project</option>
            {hierarchyOptions.projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <input
            className="input"
            value={projectName}
            disabled={pending}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Project name"
          />
        </label>
        <label className="review-kv">
          <span>Building</span>
          <select
            className="input"
            value={selectedBuilding?.id ?? ""}
            disabled={pending || buildingOptions.length === 0}
            onChange={(e) => {
              const next = buildingOptions.find((building) => building.id === e.target.value);
              if (!next) {
                setBuildingName("");
                return;
              }
              setProjectName(next.projectName);
              setBuildingName(next.name);
            }}
          >
            <option value="">Custom building</option>
            {buildingOptions.map((building) => (
              <option key={building.id} value={building.id}>
                {selectedProject ? building.name : `${building.projectName} / ${building.name}`}
              </option>
            ))}
          </select>
          <input
            className="input"
            value={buildingName}
            disabled={pending}
            onChange={(e) => setBuildingName(e.target.value)}
            placeholder="Building name"
          />
        </label>
        <label className="review-kv">
          <span>Unit</span>
          <input
            className="input"
            value={houseNumber}
            disabled={pending}
            onChange={(e) => setHouseNumber(e.target.value)}
            placeholder="Unit"
          />
        </label>
      </div>
      <div className="actions">
        {candidates.map((c) => (
          <button key={c.id} disabled={pending} onClick={() => act({ action: "link", propertyId: c.id })} className="btn ghost sm">
            <Icon name="link" size={15} />
            {candidateTitle(c)} <span className="mono" style={{ color: "var(--ink-3)" }}>{(c.score * 100).toFixed(0)}%</span>
          </button>
        ))}
        <button
          disabled={pending}
          onClick={() => act({
            action: "create",
            projectName: nullableText(projectName),
            buildingName: nullableText(buildingName),
            houseNumber: nullableText(houseNumber),
          })}
          className="btn secondary sm review-create"
        >
          <Icon name="plus" size={15} />
          Create {createLabel}
        </button>
        <button disabled={pending} onClick={() => act({ action: "dismiss" })} className="btn danger sm">
          <Icon name="x" size={15} />
          Dismiss
        </button>
      </div>
    </>
  );
}

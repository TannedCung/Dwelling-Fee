"use client";

import { useId, useMemo, useState, useTransition, type KeyboardEvent } from "react";
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

interface HierarchyOption {
  id: string;
  label: string;
  value: string;
}

function HierarchyCombobox({
  label,
  value,
  options,
  disabled,
  onSelect,
  onChange,
}: {
  label: string;
  value: string;
  options: HierarchyOption[];
  disabled: boolean;
  onSelect: (option: HierarchyOption) => void;
  onChange: (value: string) => void;
}) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = searching ? value.trim().toLocaleLowerCase("vi-VN") : "";
  const filtered = options
    .filter((option) => !query || option.label.toLocaleLowerCase("vi-VN").includes(query))
    .slice(0, 8);
  const exactMatch = options.some((option) => sameName(option.value, value));
  const choices = searching && value.trim() && !exactMatch
    ? [{ id: "__new__", label: `Use "${value.trim()}" as a new value`, value }, ...filtered]
    : filtered;

  function select(option: HierarchyOption) {
    if (option.id === "__new__") {
      setOpen(false);
      setSearching(false);
      return;
    }
    onSelect(option);
    setOpen(false);
    setSearching(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => open ? Math.min(index + 1, Math.max(choices.length - 1, 0)) : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => open ? Math.max(index - 1, 0) : Math.max(choices.length - 1, 0));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const option = choices[activeIndex];
      if (option) select(option);
      else setOpen(false);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="review-kv">
      <span>{label}</span>
      <div
        className="review-combobox"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
      >
        <input
          className="input review-hierarchy-control"
          value={value}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setSearching(false);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setSearching(true);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={`Select or enter ${label.toLowerCase()}`}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && choices[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
        />
        <button
          type="button"
          className="review-combobox-toggle"
          disabled={disabled}
          onClick={() => {
            setOpen((current) => !current);
            setSearching(false);
            setActiveIndex(0);
          }}
          aria-label={`Toggle ${label.toLowerCase()} options`}
          aria-expanded={open}
          aria-controls={listboxId}
        >
          <Icon name="chevron-down" size={15} />
        </button>
        {open && (
          <div id={listboxId} className="review-combobox-list" role="listbox">
            {choices.length > 0 ? choices.map((option, index) => (
              <button
                type="button"
                id={`${listboxId}-${index}`}
                key={option.id}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "active" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(option)}
              >
                {option.id === "__new__" && <Icon name="plus" size={14} />}
                <span>{option.label}</span>
              </button>
            )) : (
              <div className="review-combobox-empty">Type to add a new value</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
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
  const unitOptions = selectedBuilding
    ? hierarchyOptions.units.filter((unit) => unit.buildingId === selectedBuilding.id)
    : selectedProject
      ? hierarchyOptions.units.filter((unit) => unit.projectId === selectedProject.id)
      : hierarchyOptions.units;
  const projectOptions = hierarchyOptions.projects.map((project) => ({
    id: project.id,
    label: project.name,
    value: project.name,
  }));
  const reviewBuildingOptions = buildingOptions.map((building) => ({
    id: building.id,
    label: selectedProject ? building.name : `${building.projectName} / ${building.name}`,
    value: building.name,
  }));
  const reviewUnitOptions = unitOptions.map((unit) => ({
    id: unit.id,
    label: selectedBuilding
      ? unit.houseNumber
      : selectedProject
        ? [unit.buildingName, unit.houseNumber].filter(Boolean).join(" / ")
        : [unit.projectName, unit.buildingName, unit.houseNumber].filter(Boolean).join(" / "),
    value: unit.houseNumber,
  }));
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
        <HierarchyCombobox
          label="Project"
          value={projectName}
          options={projectOptions}
          disabled={pending}
          onSelect={(option) => {
            setProjectName(option.value);
            setBuildingName("");
            setHouseNumber("");
          }}
          onChange={(value) => {
            setProjectName(value);
            setBuildingName("");
            setHouseNumber("");
          }}
        />
        <HierarchyCombobox
          label="Building"
          value={buildingName}
          options={reviewBuildingOptions}
          disabled={pending}
          onSelect={(option) => {
            const next = buildingOptions.find((building) => building.id === option.id);
            if (!next) return;
            setProjectName(next.projectName);
            setBuildingName(next.name);
            setHouseNumber("");
          }}
          onChange={(value) => {
            setBuildingName(value);
            setHouseNumber("");
          }}
        />
        <HierarchyCombobox
          label="Unit"
          value={houseNumber}
          options={reviewUnitOptions}
          disabled={pending}
          onSelect={(option) => {
            const next = unitOptions.find((unit) => unit.id === option.id);
            if (next?.projectName) setProjectName(next.projectName);
            if (next?.buildingName) setBuildingName(next.buildingName);
            setHouseNumber(option.value);
          }}
          onChange={setHouseNumber}
        />
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

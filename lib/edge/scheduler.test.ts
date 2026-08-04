import assert from "node:assert/strict";
import { test } from "node:test";
import { selectSchedulableSources } from "./scheduler";

const sources = [
  {
    id: "source-a",
    label: "A",
    url: "https://example.com/a",
    kind: "http" as const,
    enabled: true,
    config: null,
  },
  {
    id: "source-b",
    label: "B",
    url: "https://example.com/b",
    kind: "http" as const,
    enabled: true,
    config: null,
  },
  {
    id: "source-c",
    label: "C",
    url: "https://example.com/c",
    kind: "http" as const,
    enabled: false,
    config: null,
  },
];

test("selectSchedulableSources skips disabled sources and sources with active jobs", () => {
  assert.deepEqual(
    selectSchedulableSources(sources, [{ sourceId: "source-b" }]).map((source) => source.id),
    ["source-a"],
  );
});

test("selectSchedulableSources returns enabled sources when no active jobs exist", () => {
  assert.deepEqual(
    selectSchedulableSources(sources, []).map((source) => source.id),
    ["source-a", "source-b"],
  );
});

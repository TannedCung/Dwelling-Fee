import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Hex } from "./protocol";
import { sourceRefForSignal } from "./service";

test("sourceRefForSignal preserves web listing URLs", () => {
  const url = "https://example.com/listing/a?x=1";
  assert.equal(sourceRefForSignal({ sourceType: "web", sourceRef: url, pageUrl: "https://example.com/search" }), url);
});

test("sourceRefForSignal derives stable item URLs for non-URL web refs", () => {
  const pageUrl = "https://example.com/search";
  const sourceRef = "card-7";
  assert.equal(
    sourceRefForSignal({ sourceType: "web", sourceRef, pageUrl }),
    `${pageUrl}#item=${sha256Hex(sourceRef).slice(0, 12)}`,
  );
});

test("sourceRefForSignal leaves non-web refs unchanged", () => {
  assert.equal(sourceRefForSignal({ sourceType: "broker", sourceRef: "zalo-thread-1", pageUrl: null }), "zalo-thread-1");
});

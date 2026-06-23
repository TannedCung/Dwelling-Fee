import { test } from "node:test";
import assert from "node:assert/strict";
import { isBaseLlm } from "@google/adk";
import { getAdkIngestModel, resolveAdkIngestModelId } from "./registry";

test("ADK ingest model follows OpenAI deployment config through adk-llm-bridge", () => {
  const env = snapshotEnv(["AI_PROVIDER", "AI_EXTRACTION_MODEL", "ADK_INGEST_MODEL", "GOOGLE_ADK_MODEL", "OPENAI_API_KEY"]);
  process.env.AI_PROVIDER = "openai";
  process.env.AI_EXTRACTION_MODEL = "gpt-4.1-mini";
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.ADK_INGEST_MODEL;
  delete process.env.GOOGLE_ADK_MODEL;

  assert.equal(resolveAdkIngestModelId(), "openai/gpt-4.1-mini");
  const model = getAdkIngestModel();
  assert.equal(isBaseLlm(model), true);
  assert.equal(typeof model === "string" ? model : model.model, "gpt-4.1-mini");

  restoreEnv(env);
});

test("ADK ingest model keeps native Gemini names as strings", () => {
  const env = snapshotEnv(["AI_PROVIDER", "AI_EXTRACTION_MODEL", "ADK_INGEST_MODEL", "GOOGLE_ADK_MODEL"]);
  process.env.AI_PROVIDER = "google";
  delete process.env.AI_EXTRACTION_MODEL;
  delete process.env.ADK_INGEST_MODEL;
  delete process.env.GOOGLE_ADK_MODEL;

  assert.equal(resolveAdkIngestModelId(), "gemini-2.5-flash");
  assert.equal(getAdkIngestModel(), "gemini-2.5-flash");

  restoreEnv(env);
});

function snapshotEnv(keys: string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Map<string, string | undefined>): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

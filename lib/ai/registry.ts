import { createProviderRegistry, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createMockModel } from "./mock";

/**
 * Multi-provider LLM layer (design §8). The extractor and any future LLM step go
 * through here so the provider/model is a deployment config, not hard-coded.
 *
 * Select via env:
 *   AI_PROVIDER          = anthropic | openai | google   (default: anthropic)
 *   AI_EXTRACTION_MODEL  = optional model id override (e.g. "gpt-5.4-mini")
 *
 * Provider API keys (only the selected provider's key is required):
 *   ANTHROPIC_API_KEY · OPENAI_API_KEY · GOOGLE_GENERATIVE_AI_API_KEY
 */
export const registry = createProviderRegistry({ anthropic, openai, google });

export type Provider = "anthropic" | "openai" | "google";

// Cheap, high-volume "extraction tier" defaults per provider (model IDs verified
// against the Vercel AI Gateway catalog). Override per-deploy with AI_EXTRACTION_MODEL.
const DEFAULT_EXTRACTION_MODEL: Record<Provider, string> = {
  anthropic: "claude-haiku-4.5",
  openai: "gpt-4.1-mini",
  google: "gemini-2.5-flash",
};

function resolveProvider(): Provider {
  const p = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();
  if (p === "anthropic" || p === "openai" || p === "google") return p;
  throw new Error(`Unsupported AI_PROVIDER "${p}". Use anthropic | openai | google.`);
}

export function resolveExtractionModelId(): string {
  const provider = resolveProvider();
  const model = process.env.AI_EXTRACTION_MODEL || DEFAULT_EXTRACTION_MODEL[provider];
  return `${provider}:${model}`;
}

export function getExtractionModel(): LanguageModel {
  // Deterministic offline model for tests — no provider call, no API key.
  if (process.env.MOCK_AI === "1") return createMockModel();
  return registry.languageModel(resolveExtractionModelId() as `${Provider}:${string}`);
}

// Recorded on every observation (price_observation.extractor) for reproducibility.
export const EXTRACTOR_VERSION = `${resolveExtractionModelId()}/extract-v1`;

import { createProviderRegistry, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";

/**
 * Multi-provider LLM layer (design §8). The extractor and any future LLM step go
 * through here so the provider/model is a deployment config, not hard-coded.
 *
 * Select via env:
 *   AI_PROVIDER          = anthropic | openai | google   (default: anthropic)
 *   AI_EXTRACTION_MODEL  = optional model id override (e.g. "gpt-5.4-mini")
 *   ADK_INGEST_MODEL     = optional Google ADK model id for the main ingest agent
 *
 * Provider API keys (only the selected provider's key is required):
 *   ANTHROPIC_API_KEY · OPENAI_API_KEY · GOOGLE_GENERATIVE_AI_API_KEY
 */
export const registry = createProviderRegistry({ anthropic, openai, google });

export type Provider = "anthropic" | "openai" | "google";

// Cheap, high-volume "extraction tier" defaults per provider. Override
// per-deploy with AI_EXTRACTION_MODEL.
const DEFAULT_EXTRACTION_MODEL: Record<Provider, string> = {
  anthropic: "claude-haiku-4.5",
  openai: "gpt-4.1-mini",
  google: "gemini-2.5-flash",
};

const DEFAULT_ADK_INGEST_MODEL = "gemini-2.5-flash";

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
  return registry.languageModel(resolveExtractionModelId() as `${Provider}:${string}`);
}

export function resolveAdkIngestModelId(): string {
  return process.env.ADK_INGEST_MODEL || process.env.GOOGLE_ADK_MODEL || DEFAULT_ADK_INGEST_MODEL;
}

export function ensureAdkGoogleApiKey(): void {
  if (!process.env.GEMINI_API_KEY && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GEMINI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  }
}

// Recorded on every observation (price_observation.extractor) for reproducibility.
export const EXTRACTOR_VERSION = `${resolveExtractionModelId()}/extract-v2`;

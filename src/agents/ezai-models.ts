import type { ModelDefinitionConfig } from "../config/types.js";

export const EZAI_BASE_URL = "https://ezaiapi.com";
export const EZAI_DEFAULT_MODEL_ID = "claude-opus-4.6";
export const EZAI_DEFAULT_MODEL_REF = `ezai/${EZAI_DEFAULT_MODEL_ID}`;
export const EZAI_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export const EZAI_MODEL_CATALOG = [
  // Anthropic Claude
  {
    id: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 8192,
  },
  {
    id: "claude-opus-4.5",
    name: "Claude Opus 4.5",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 8192,
  },
  {
    id: "claude-opus-4.6",
    name: "Claude Opus 4.6",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 8192,
  },
  {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 8192,
  },
  {
    id: "claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 8192,
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 8192,
  },
  // OpenAI GPT
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 4096,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 4096,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 4096,
  },
  {
    id: "gpt-5",
    name: "GPT-5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 8192,
  },
  {
    id: "gpt-5-mini",
    name: "GPT-5 mini",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 8192,
  },
  {
    id: "gpt-5.1",
    name: "GPT-5.1",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 8192,
  },
  {
    id: "gpt-5.1-codex",
    name: "GPT-5.1 Codex",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 8192,
  },
  {
    id: "gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 8192,
  },
  {
    id: "gpt-5.1-codex-mini",
    name: "GPT-5.1 Codex Mini",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 8192,
  },
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 8192,
  },
  {
    id: "gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 8192,
  },
  // Google Gemini
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 2000000,
    maxTokens: 8192,
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 2000000,
    maxTokens: 8192,
  },
  {
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 2000000,
    maxTokens: 8192,
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 2000000,
    maxTokens: 8192,
  },
  // xAI Grok
  {
    id: "grok-code-fast-1",
    name: "Grok Code Fast 1",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 8192,
  },
] as const;

export type EzaiCatalogEntry = (typeof EZAI_MODEL_CATALOG)[number];

export function buildEzaiModelDefinition(entry: EzaiCatalogEntry): ModelDefinitionConfig {
  return {
    id: entry.id,
    name: entry.name,
    reasoning: entry.reasoning,
    input: [...entry.input],
    cost: EZAI_DEFAULT_COST,
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
  };
}

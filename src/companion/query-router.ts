/**
 * Smart Query Router — combines heuristic fast-path with optional LLM classifier.
 *
 * Flow:
 * 1. Run heuristic classifier (~0ms). If high-confidence → use immediately.
 * 2. If ambiguous (heuristic returns "knowledge" = default) AND LLM classifier
 *    is configured → call small model with tight timeout (budget: 300ms).
 * 3. If LLM timeout/error → fall back to heuristic result.
 *
 * This means ~70% of queries use 0ms routing, ~30% use 100-300ms LLM routing.
 */

import type { ModelProviderConfig } from "../config/types.models.js";
import { classifyQueryTier, type QueryTier } from "./query-classifier.js";

// ── Types ────────────────────────────────────────────────────────────

export interface RouterClassifierConfig {
  /** Resolved API type: "google-generative-ai" or OpenAI-compatible */
  apiType: "google" | "openai";
  /** Base URL of the provider */
  baseUrl: string;
  /** Resolved API key */
  apiKey: string;
  /** Model ID to use */
  model: string;
  /** Timeout in ms */
  timeoutMs: number;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 300;

const CLASSIFICATION_PROMPT = `Classify this user message into exactly one tier:
- "chat": greetings, emotions, small talk, confirmations, reactions, short casual replies
- "knowledge": questions, explanations, advice, information requests, conceptual discussions (no tools needed)
- "action": code writing/editing, file operations, commands, tool usage, complex multi-step tasks, search requests

Examples:
- "hi Arona~" → chat
- "mệt quá" → chat
- "おはよう" → chat
- "ok" / "ừ" / "got it" → chat
- "haha lol 😂" → chat
- "how does async/await work?" → knowledge
- "giải thích dependency injection" → knowledge
- "what's the difference between TCP and UDP?" → knowledge
- "viết code sort array" → action
- "fix bug in login.ts" → action
- "tìm kiếm trên mạng về React 19" → action
- "create a new file called utils.ts" → action

Edge cases:
- Questions ABOUT code concepts (not asking to write code) → "knowledge"
- Sharing a code snippet for review/explanation → "knowledge" (unless they say "fix" or "edit")
- Messages in any language (Vietnamese, English, Japanese, mixed) follow the same rules

Reply with ONLY the tier name, nothing else.`;

const VALID_TIERS = new Set<QueryTier>(["chat", "knowledge", "action"]);

// ── Resolve Config ───────────────────────────────────────────────────

/**
 * Resolve a RouterClassifierConfig from the smartRouting.classifier config + providers.
 * Returns null if not enabled or provider not found.
 */
export function resolveRouterConfig(params: {
  classifier?: {
    enabled?: boolean;
    provider?: string;
    model?: string;
    timeoutMs?: number;
  };
  providers?: Record<string, ModelProviderConfig>;
}): RouterClassifierConfig | null {
  const cfg = params.classifier;
  if (!cfg?.enabled || !cfg.provider) {
    return null;
  }

  const providerConfig = params.providers?.[cfg.provider];
  if (!providerConfig) {
    return null;
  }

  const apiKey = typeof providerConfig.apiKey === "string" ? providerConfig.apiKey : undefined;
  if (!apiKey) {
    return null;
  }

  const isGoogle = providerConfig.api === "google-generative-ai";
  const apiType: "google" | "openai" = isGoogle ? "google" : "openai";

  return {
    apiType,
    baseUrl: providerConfig.baseUrl,
    apiKey,
    model: cfg.model ?? "gemini-2.0-flash-lite",
    timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

// ── LLM Callers ──────────────────────────────────────────────────────

async function classifyViaGoogle(
  config: RouterClassifierConfig,
  userText: string,
): Promise<QueryTier | null> {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: CLASSIFICATION_PROMPT + "\n\nMessage: " + userText }],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 10,
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!resp.ok) {
    return null;
  }
  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return parseTierResponse(data.candidates?.[0]?.content?.parts?.[0]?.text);
}

async function classifyViaOpenAI(
  config: RouterClassifierConfig,
  userText: string,
): Promise<QueryTier | null> {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const chatUrl = baseUrl.endsWith("/v1")
    ? `${baseUrl}/chat/completions`
    : baseUrl.includes("/chat/completions")
      ? baseUrl
      : `${baseUrl}/v1/chat/completions`;

  const body = {
    model: config.model,
    messages: [
      { role: "system", content: CLASSIFICATION_PROMPT },
      { role: "user", content: userText },
    ],
    temperature: 0,
    max_tokens: 10,
  };

  const resp = await fetch(chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!resp.ok) {
    return null;
  }
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return parseTierResponse(data.choices?.[0]?.message?.content);
}

// ── Parse Response ───────────────────────────────────────────────────

function parseTierResponse(raw: string | null | undefined): QueryTier | null {
  if (!raw) {
    return null;
  }
  const cleaned = raw.trim().toLowerCase().replace(/["']/g, "");
  if (VALID_TIERS.has(cleaned as QueryTier)) {
    return cleaned as QueryTier;
  }
  // Try to extract tier from longer response
  for (const tier of VALID_TIERS) {
    if (cleaned.includes(tier)) {
      return tier;
    }
  }
  return null;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Route a query using heuristic fast-path + optional LLM classifier.
 *
 * @param prompt - The user's message text
 * @param hasImage - Whether the message includes an image attachment
 * @param classifierConfig - Resolved LLM classifier config (null = heuristic only)
 * @returns The classified query tier
 */
export async function routeQuery(params: {
  prompt: string;
  hasImages?: boolean;
  classifierConfig: RouterClassifierConfig | null;
}): Promise<QueryTier> {
  // Step 1: Heuristic fast-path (~0ms)
  const heuristicResult = classifyQueryTier({
    prompt: params.prompt,
    hasImages: params.hasImages,
  });

  // Step 2: If heuristic is confident (not "knowledge" default), use it immediately
  // The heuristic returns "knowledge" as its fallback for ambiguous queries
  if (heuristicResult !== "knowledge") {
    return heuristicResult;
  }

  // Step 3: If no LLM classifier configured, use heuristic result
  if (!params.classifierConfig) {
    return heuristicResult;
  }

  // Step 4: Call LLM for ambiguous queries (budget: configured timeout)
  try {
    const llmResult =
      params.classifierConfig.apiType === "google"
        ? await classifyViaGoogle(params.classifierConfig, params.prompt)
        : await classifyViaOpenAI(params.classifierConfig, params.prompt);

    // Use LLM result if valid, otherwise fall back to heuristic
    return llmResult ?? heuristicResult;
  } catch {
    // Timeout or network error — fall back to heuristic
    return heuristicResult;
  }
}

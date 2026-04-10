/**
 * AI-based Affection Analyzer for the Companion Emotional Engine.
 *
 * Uses a lightweight LLM to classify the emotional intent of a user message.
 * Reuses an existing provider from `models.providers` config — no separate API key needed.
 * Falls back to regex-based analysis if not configured or on failure.
 */

import type { ModelProviderConfig } from "../config/types.models.js";
import type { Mood, MoodTrigger } from "./emotional-state.js";

// ── Types ────────────────────────────────────────────────────────────

export interface AffectionAnalysisConfig {
  /** Resolved API type: "google-generative-ai" or OpenAI-compatible */
  apiType: "google" | "openai";
  /** Base URL of the provider */
  baseUrl: string;
  /** Resolved API key (plain string) */
  apiKey: string;
  /** Model ID to use */
  model: string;
  /** Timeout in ms */
  timeoutMs: number;
}

export interface AffectionAnalysisResult {
  mood: Mood;
  intensity: number;
  affectionDelta: number;
  reason: string;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5000;

// ── Classification Prompt ────────────────────────────────────────────

const CLASSIFICATION_PROMPT = `You are a sentiment classifier for a companion AI system.
Analyze the user's message and classify its emotional intent.

Return ONLY a valid JSON object with these fields:
- "mood": one of "happy", "neutral", "sad", "excited", "worried", "caring", "sleepy", "bored", "focused", "curious", "playful", "grateful", "nostalgic"
- "intensity": number 0.0 to 1.0 (how strong is the emotion)
- "affectionDelta": integer -10 to +10 (how much this affects the relationship)
  - Positive: praise, thanks, gifts, compliments, jokes, caring → +1 to +6
  - Neutral: normal questions, technical talk, bugs → 0
  - Negative: rudeness, ignoring, broken promises, dismissal → -1 to -5
- "reason": short tag describing the trigger (e.g. "khen-ngợi", "thô-lỗ", "normal-chat")

Example outputs:
{"mood":"happy","intensity":0.6,"affectionDelta":3,"reason":"khen-ngợi"}
{"mood":"neutral","intensity":0.2,"affectionDelta":0,"reason":"technical-question"}
{"mood":"sad","intensity":0.4,"affectionDelta":-3,"reason":"bị-phạt-ngượt"}

IMPORTANT: Return ONLY the JSON object, no markdown, no explanation.`;

// ── Resolve Config from Provider ─────────────────────────────────────

/**
 * Resolve an AffectionAnalysisConfig from the companion config + models.providers.
 * Returns null if not enabled or provider not found.
 */
export function resolveAnalysisConfig(params: {
  affectionAnalysis?: {
    enabled?: boolean;
    provider?: string;
    model?: string;
    timeoutMs?: number;
  };
  providers?: Record<string, ModelProviderConfig>;
}): AffectionAnalysisConfig | null {
  const cfg = params.affectionAnalysis;
  if (!cfg?.enabled || !cfg.provider) {
    return null;
  }

  const providerConfig = params.providers?.[cfg.provider];
  if (!providerConfig) {
    return null;
  }

  // Resolve API key — must be a resolved string at this point
  const apiKey = typeof providerConfig.apiKey === "string" ? providerConfig.apiKey : undefined;
  if (!apiKey) {
    return null;
  }

  // Detect API type from provider's `api` field
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

// ── API Callers ──────────────────────────────────────────────────────

async function callGoogleGenerativeAI(
  config: AffectionAnalysisConfig,
  userText: string,
): Promise<string | null> {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: CLASSIFICATION_PROMPT + "\n\nUser message:\n" + userText }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 200,
      responseMimeType: "application/json",
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
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function callOpenAICompatible(
  config: AffectionAnalysisConfig,
  userText: string,
): Promise<string | null> {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  // Ensure /v1/chat/completions path
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
    temperature: 0.1,
    max_tokens: 200,
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
  return data.choices?.[0]?.message?.content ?? null;
}

// ── Parse Response ───────────────────────────────────────────────────

const VALID_MOODS = new Set<Mood>([
  "happy",
  "neutral",
  "sad",
  "excited",
  "worried",
  "caring",
  "sleepy",
  "bored",
  "focused",
  "curious",
  "playful",
  "grateful",
  "nostalgic",
]);

function parseAnalysisResponse(raw: string | null): AffectionAnalysisResult | null {
  if (!raw) {
    return null;
  }
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const mood = parsed.mood as string;
    if (!VALID_MOODS.has(mood as Mood)) {
      return null;
    }

    const intensity = Number(parsed.intensity);
    if (isNaN(intensity) || intensity < 0 || intensity > 1) {
      return null;
    }

    const affectionDelta = Math.round(Number(parsed.affectionDelta));
    if (isNaN(affectionDelta) || affectionDelta < -10 || affectionDelta > 10) {
      return null;
    }

    return {
      mood: mood as Mood,
      intensity: Math.max(0, Math.min(1, intensity)),
      affectionDelta: Math.max(-10, Math.min(10, affectionDelta)),
      reason: typeof parsed.reason === "string" ? parsed.reason : "ai-analysis",
    };
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Analyze a user message using a lightweight LLM to classify emotional intent.
 * Non-blocking, best-effort — designed to never throw.
 */
export async function analyzeAffectionWithAI(
  userText: string,
  config: AffectionAnalysisConfig,
): Promise<AffectionAnalysisResult | null> {
  try {
    if (!userText.trim() || userText.length < 2) {
      return null;
    }

    const rawResponse =
      config.apiType === "google"
        ? await callGoogleGenerativeAI(config, userText)
        : await callOpenAICompatible(config, userText);

    return parseAnalysisResponse(rawResponse);
  } catch {
    return null;
  }
}

/**
 * Convert an AI analysis result into a MoodTrigger for applyTrigger().
 */
export function aiResultToMoodTrigger(result: AffectionAnalysisResult): MoodTrigger {
  return {
    type: "keyword",
    source: `ai:${result.reason}`,
    delta: { [result.mood]: result.intensity },
  };
}

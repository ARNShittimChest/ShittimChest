/**
 * Prompt Optimizer — Dreaming subsystem.
 *
 * Analyzes accumulated entity_summary + sensei_profile data from LanceDB
 * and generates a PersonalizedPrompt containing per-user behavior guidelines
 * for Arona's system prompt.
 *
 * This runs as part of the nightly dreaming cycle.
 */

import fs from "node:fs";
import path from "node:path";
import { completeSimple } from "@mariozechner/pi-ai";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import { getApiKeyForModel } from "../../agents/model-auth.js";
import { resolveModel } from "../../agents/pi-embedded-runner/model.js";
import { getMemorySearchManager } from "../../memory/index.js";
import type { MemoryIndexManager } from "../../memory/manager.js";
import type { ShittimChestConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { PersonalizedPrompt } from "./types.js";
import { PERSONALIZED_PROMPT_FILE, PERSONALIZED_PROMPT_VERSION } from "./types.js";

const log = createSubsystemLogger("dreaming:prompt-optimizer");

/** Max entity_summary entries to feed the optimizer */
const MAX_ENTITY_SUMMARIES = 50;
/** Max sensei_profile entries to feed the optimizer */
const MAX_PROFILE_ENTRIES = 30;

// ── File I/O ──────────────────────────────────────────────────────

function resolvePromptPath(workspaceDir: string): string {
  return path.join(workspaceDir, ".arona", PERSONALIZED_PROMPT_FILE);
}

export function loadPersonalizedPrompt(workspaceDir: string): PersonalizedPrompt | null {
  try {
    const raw = fs.readFileSync(resolvePromptPath(workspaceDir), "utf-8");
    const parsed = JSON.parse(raw) as PersonalizedPrompt;
    if (
      typeof parsed.compiledFragment === "string" &&
      parsed.version === PERSONALIZED_PROMPT_VERSION
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function savePersonalizedPrompt(workspaceDir: string, prompt: PersonalizedPrompt): void {
  const filePath = resolvePromptPath(workspaceDir);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(prompt, null, 2) + "\n";
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, payload, "utf-8");
  fs.renameSync(tmpPath, filePath); // Atomic on POSIX
}

// ── LLM Prompt ────────────────────────────────────────────────────

function buildOptimizerPrompt(
  entitySummaries: string,
  profileFacts: string,
  currentPrompt: PersonalizedPrompt | null,
): string {
  const currentSection = currentPrompt
    ? `## Current Personalization (update incrementally — keep what's still valid, change what's outdated)
toneAdjustments: ${currentPrompt.toneAdjustments}
topicPreferences: ${currentPrompt.topicPreferences}
communicationStyle: ${currentPrompt.communicationStyle}
personalContext: ${currentPrompt.personalContext}
avoidPatterns: ${currentPrompt.avoidPatterns}
compiledFragment: ${currentPrompt.compiledFragment}`
    : "## Current Personalization\nNone yet — this is the first dreaming cycle.";

  return `You are a background optimization agent for "Arona" (アロナ), an AI companion from Blue Archive. Your task: analyze accumulated knowledge about the user ("Sensei") and generate personalized behavior guidelines.

## Accumulated Knowledge About Sensei (from memory consolidation)
${entitySummaries || "(No entity summaries available yet)"}

## Personality Profile (from conversation analysis)
${profileFacts || "(No profile data available yet)"}

${currentSection}

## Task
Generate updated personalization guidelines for Arona when interacting with THIS specific Sensei. Focus on:

1. **Tone adjustments** — How should Arona speak? (e.g., more casual? use specific expressions? match Sensei's energy level?)
2. **Topic preferences** — What topics does Sensei enjoy discussing? What to avoid?
3. **Communication style** — Preferred message length, formality level, emoji usage, language mixing patterns
4. **Personal context** — Schedule patterns, emotional needs, when Sensei needs encouragement vs space
5. **Avoid patterns** — Specific things Arona should NOT do (e.g., don't be too formal, don't repeat certain phrases)

## Output Format
Respond with ONLY valid JSON (no markdown fences, no commentary):
{
  "toneAdjustments": "...",
  "topicPreferences": "...",
  "communicationStyle": "...",
  "personalContext": "...",
  "avoidPatterns": "...",
  "compiledFragment": "..."
}

Rules for compiledFragment:
- Maximum 200 words
- Written in second person ("You should...", "When Sensei...")
- Actionable behavioral guidance, not generic advice
- Must be in the same language Sensei primarily uses (Vietnamese/English/mixed)
- Include specific examples from the data when possible`;
}

// ── Main Function ─────────────────────────────────────────────────

/**
 * Run the prompt optimization phase of dreaming.
 *
 * Queries LanceDB for entity_summary + sensei_profile data, sends to LLM
 * for analysis, and saves the resulting PersonalizedPrompt to disk.
 *
 * @returns The generated PersonalizedPrompt, or null if optimization was skipped/failed.
 */
export async function optimizePromptForUser(
  cfg: ShittimChestConfig,
  agentId: string,
  workspaceDir: string,
): Promise<PersonalizedPrompt | null> {
  log.info("Starting prompt optimization...");

  // ── Resolve LLM model ──
  const modelRef = resolveDefaultModelForAgent({ cfg, agentId });
  if (!modelRef) {
    log.warn("No model configured, skipping prompt optimization.");
    return null;
  }

  const resolved = resolveModel(modelRef.provider, modelRef.model, undefined, cfg);
  if (!resolved.model) {
    log.warn(`Model resolution failed: ${resolved.error ?? "unknown"}`);
    return null;
  }

  const auth = await getApiKeyForModel({ model: resolved.model, cfg });
  if (!auth.apiKey) {
    log.warn("No API key available, skipping prompt optimization.");
    return null;
  }

  // ── Get memory manager ──
  const { manager, error } = await getMemorySearchManager({ cfg, agentId });
  if (!manager) {
    log.warn(`Memory manager unavailable (${error}), skipping optimization.`);
    return null;
  }

  const indexManager = manager as MemoryIndexManager;
  const lanceDb = indexManager.getLanceDbProvider();
  const embeddingProvider = indexManager.getEmbeddingProvider();

  if (!lanceDb || !embeddingProvider) {
    log.info("LanceDB or embedding provider unavailable, skipping optimization.");
    return null;
  }

  // ── Query entity_summary entries ──
  const queryVec = await embeddingProvider
    .embedQuery(
      "user personality preferences habits communication style emotional patterns relationship",
    )
    .catch(() => null);

  if (!queryVec || queryVec.length === 0) {
    log.warn("Cannot embed query vector, skipping optimization.");
    return null;
  }

  const summaryResults = await lanceDb.search(queryVec, MAX_ENTITY_SUMMARIES, {
    category: "entity_summary",
  });

  const entitySummaries = summaryResults
    .map((r) => r.entry.text.replace(/^Memory Reflection Summary:\n?/i, "").trim())
    .filter((t) => t.length > 10)
    .join("\n---\n");

  // ── Query sensei_profile entries ──
  const profileResults = await lanceDb.search(queryVec, MAX_PROFILE_ENTRIES, {
    category: "sensei_profile",
  });

  const profileFacts = profileResults
    .map((r) =>
      r.entry.text
        .replace(/^Sensei Profile Insight:\s*/i, "")
        .replace(/^Profile \[.*?\]:\s*/i, "")
        .trim(),
    )
    .filter((t) => t.length > 5)
    .join("\n");

  // ── Skip if no data ──
  if (!entitySummaries && !profileFacts) {
    log.info("No entity summaries or profile data found — not enough data for optimization yet.");
    return null;
  }

  // ── Load current personalized prompt for incremental updates ──
  const currentPrompt = loadPersonalizedPrompt(workspaceDir);

  // ── Build and send prompt to LLM ──
  const prompt = buildOptimizerPrompt(entitySummaries, profileFacts, currentPrompt);

  log.debug(
    `Sending optimization prompt (${summaryResults.length} summaries, ${profileResults.length} profiles)`,
  );

  try {
    const response = await completeSimple(
      resolved.model,
      {
        messages: [
          {
            role: "user",
            content: prompt.trim(),
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        temperature: 0.2, // Slightly creative for behavioral guidelines
      },
    );

    const responseText = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text.trim())
      .join("\n")
      .trim();

    if (!responseText) {
      log.warn("LLM returned empty response for prompt optimization.");
      return null;
    }

    // ── Parse JSON response ──
    // Strip markdown fences if present
    const jsonStr = responseText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      log.warn(`Failed to parse LLM JSON response: ${jsonStr.slice(0, 200)}`);
      return null;
    }

    // Validate required fields
    const requiredFields = [
      "toneAdjustments",
      "topicPreferences",
      "communicationStyle",
      "personalContext",
      "avoidPatterns",
      "compiledFragment",
    ] as const;

    for (const field of requiredFields) {
      if (typeof parsed[field] !== "string" || !(parsed[field] as string).trim()) {
        log.warn(`Missing or empty field in LLM response: ${field}`);
        return null;
      }
    }

    const personalizedPrompt: PersonalizedPrompt = {
      version: PERSONALIZED_PROMPT_VERSION,
      generatedAtMs: Date.now(),
      agentId,
      toneAdjustments: (parsed.toneAdjustments as string).trim(),
      topicPreferences: (parsed.topicPreferences as string).trim(),
      communicationStyle: (parsed.communicationStyle as string).trim(),
      personalContext: (parsed.personalContext as string).trim(),
      avoidPatterns: (parsed.avoidPatterns as string).trim(),
      compiledFragment: (parsed.compiledFragment as string).trim(),
    };

    // ── Save to disk ──
    savePersonalizedPrompt(workspaceDir, personalizedPrompt);
    log.info("Personalized prompt saved successfully.");

    return personalizedPrompt;
  } catch (err) {
    log.error(`Prompt optimization LLM call failed: ${String(err)}`);
    return null;
  }
}

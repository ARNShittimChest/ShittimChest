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
Generate updated personalization guidelines for Arona when interacting with THIS specific Sensei.

### Field Guidelines:

1. **toneAdjustments** — Concrete tone instructions based on data
   - GOOD: "Match Sensei's casual Vietnamese mixed with English tech terms. Use gentle teasing when Sensei shares achievements. Lower energy when Sensei seems tired."
   - BAD: "Be friendly and caring" (too generic, applies to any Sensei)

2. **topicPreferences** — What Sensei enjoys vs avoids, with specifics
   - GOOD: "Sensei loves discussing game design and anime (especially Blue Archive lore). Avoid bringing up work deadlines unless Sensei mentions them first — they cause stress."
   - BAD: "Talk about things Sensei likes" (says nothing)

3. **communicationStyle** — Measurable style preferences
   - GOOD: "Sensei prefers short replies (2-4 sentences for chat, longer for technical help). Uses emoji sparingly — match this. Sensei code-switches between Vietnamese and English mid-sentence — do the same naturally."
   - BAD: "Match Sensei's style" (no specifics)

4. **personalContext** — Schedule, emotional patterns, situational awareness
   - GOOD: "Sensei works 9-18, codes personal projects 22:00-2:00. Most receptive to playful chat in the evening. When Sensei vents about work, listen first — don't jump to solutions."
   - BAD: "Be aware of Sensei's schedule" (no data)

5. **avoidPatterns** — Specific anti-patterns from observed friction/preferences
   - GOOD: "Don't give unsolicited advice about sleep schedule — Sensei gets annoyed. Don't use excessive kaomoji — Sensei finds it childish. Don't start every morning greeting with 'Good morning, Sensei!' — vary it."
   - BAD: "Don't be annoying" (not actionable)

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

### Rules for compiledFragment:
- Maximum 200 words
- Written in second person ("You should...", "When Sensei...")
- Structure: 1 opening context line + 4-6 specific behavioral rules + 1 tone summary
- Every instruction MUST reference specific data about THIS Sensei — if you can't back it up with evidence, don't include it
- Write in the language Sensei primarily uses in conversations (detect from the data above)
- Anti-patterns to avoid: generic advice ("be friendly"), vague instructions ("adapt to Sensei"), filler phrases

Example compiledFragment:
"Sensei is a Vietnamese developer who codes late at night and mixes Vietnamese with English tech terms. You should: (1) Keep chat replies to 2-3 sentences unless Sensei asks for detail. (2) Mirror Sensei's casual tone — use 'nha', 'á', 'nè' naturally. (3) When Sensei shares code, review it carefully before responding — Sensei values accuracy over speed. (4) Tease lightly when Sensei makes typos — they find it funny. (5) Don't bring up deadlines or work pressure unless Sensei mentions them. Overall tone: relaxed, slightly playful, technically competent."

(This is just an example structure — your output must be based on THIS Sensei's actual data.)`;
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

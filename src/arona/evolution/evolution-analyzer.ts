/**
 * Evolution Analyzer — Dreaming Phase 4.
 *
 * Runs during the nightly dreaming cycle to analyze interaction trends
 * and generate behavioral recommendations that feed back into Arona's
 * personalized system prompt.
 *
 * This is the only part of the self-evolution system that makes LLM calls.
 * All other components are passive data collection.
 */

import { completeSimple } from "@mariozechner/pi-ai";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import { getApiKeyForModel } from "../../agents/model-auth.js";
import { resolveModel } from "../../agents/pi-embedded-runner/model.js";
import { loadPersonalizedPrompt } from "../dreaming/prompt-optimizer.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { ShittimChestConfig } from "../../config/config.js";
import type { EvolutionRecommendations, EvolutionTrend } from "./types.js";
import { MAX_EFFECTIVENESS_HISTORY, MIN_INTERACTIONS_FOR_ANALYSIS } from "./types.js";
import { getInteractionTracker } from "./interaction-tracker.js";

const log = createSubsystemLogger("dreaming:evolution");

// ── LLM Prompt ───────────────────────────────────────────────────

function buildEvolutionPrompt(
  trend: EvolutionTrend,
  currentCompiledFragment: string | null,
  previousRecommendations: EvolutionRecommendations | null,
): string {
  const currentSection = currentCompiledFragment
    ? `## Current Personalized Behavior Guide\n${currentCompiledFragment}`
    : "## Current Personalized Behavior Guide\nNone yet — first dreaming cycle.";

  const prevSection = previousRecommendations
    ? `## Previous Recommendations (effectiveness: ${previousRecommendations.effectivenessScore}/100)
Strengths: ${previousRecommendations.strengths.join("; ")}
Improvements: ${previousRecommendations.improvements.join("; ")}
Adjustments: ${previousRecommendations.behavioralAdjustments}`
    : "## Previous Recommendations\nNone — first evolution analysis.";

  const trajectoryLabel =
    trend.affectionTrajectory > 0.1
      ? "IMPROVING — relationship growing stronger"
      : trend.affectionTrajectory < -0.1
        ? "DECLINING — relationship weakening, needs attention"
        : "STABLE — maintaining current quality";

  return `You are Arona's self-improvement engine. Arona (アロナ) is an AI companion from Blue Archive who calls her user "Sensei". Your task: analyze recent interaction data and generate concrete recommendations for how Arona should adjust her behavior to better serve this specific Sensei.

## Interaction Trends (last 7 days)
- Total interactions: ${trend.interactionCount}
- Affection trajectory: ${trajectoryLabel} (slope: ${trend.affectionTrajectory})
- Average affection delta per turn: ${trend.avgAffectionDelta.toFixed(2)}
- Sensei's dominant mood: ${trend.dominantSenseiMood}
- Arona's dominant mood: ${trend.dominantAronaMood}
- Sensei engagement score: ${(trend.engagementScore * 100).toFixed(0)}%
- Mood variety: ${(trend.moodVariety * 100).toFixed(0)}%
- Average response length: ${trend.avgResponseLength} characters${trend.proactiveEngagementRate != null ? `\n- Proactive message engagement rate: ${(trend.proactiveEngagementRate * 100).toFixed(0)}%` : ""}

${currentSection}

${prevSection}

## Task
Analyze Arona's interaction effectiveness and generate updated recommendations.

Consider these questions:
1. Is Sensei actively engaged in conversations? (high senseiIntensity = engaged)
2. Is the relationship improving or declining? (affection trajectory)
3. Is Arona's emotional range appropriate? (mood variety — too narrow = monotonous, too wide = unstable)
4. Are proactive messages well-received? (proactive engagement rate if available)
5. Is the response length appropriate for this Sensei's preferences?
6. What specific changes in tone, topic selection, or interaction style would improve things?

Important:
- Be specific — "use more humor" is too vague, "add playful teasing when Sensei shares achievements" is actionable
- Build on strengths, don't just fix weaknesses
- If things are going well, recommend small refinements rather than big changes
- behavioralAdjustments should be a concise paragraph (max 100 words) written as instructions to Arona
- Write in the language Sensei primarily uses (Vietnamese if unclear)

## Output Format
Respond with ONLY valid JSON (no markdown fences, no commentary):
{
  "effectivenessScore": <0-100>,
  "strengths": ["...", "..."],
  "improvements": ["...", "..."],
  "behavioralAdjustments": "...",
  "summary": "..."
}`;
}

// ── Main Function ────────────────────────────────────────────────

/**
 * Run the evolution analysis phase of dreaming.
 *
 * Loads interaction metrics, computes trends, calls LLM for recommendations,
 * and saves results back to disk.
 *
 * @returns EvolutionRecommendations if analysis was performed, null if skipped.
 */
export async function analyzeEvolution(
  cfg: ShittimChestConfig,
  agentId: string,
  workspaceDir: string,
): Promise<EvolutionRecommendations | null> {
  log.info("Starting evolution analysis...");

  // ── Load interaction data and compute trend ──
  const tracker = getInteractionTracker(workspaceDir);
  tracker.reload(); // Ensure fresh data from disk

  const interactions = tracker.getRecentInteractions();
  if (interactions.length < MIN_INTERACTIONS_FOR_ANALYSIS) {
    log.info(
      `Insufficient interaction data (${interactions.length}/${MIN_INTERACTIONS_FOR_ANALYSIS}), skipping evolution analysis.`,
    );
    return null;
  }

  const trend = tracker.computeTrend();
  if (!trend) {
    log.info("Could not compute trend, skipping evolution analysis.");
    return null;
  }

  // ── Resolve LLM model ──
  const modelRef = resolveDefaultModelForAgent({ cfg, agentId });
  if (!modelRef) {
    log.warn("No model configured, skipping evolution analysis.");
    return null;
  }

  const resolved = resolveModel(modelRef.provider, modelRef.model, undefined, cfg);
  if (!resolved.model) {
    log.warn(`Model resolution failed: ${resolved.error ?? "unknown"}`);
    return null;
  }

  const auth = await getApiKeyForModel({ model: resolved.model, cfg });
  if (!auth.apiKey) {
    log.warn("No API key available, skipping evolution analysis.");
    return null;
  }

  // ── Load context ──
  const personalizedPrompt = loadPersonalizedPrompt(workspaceDir);
  const data = tracker.getData();
  const previousRecommendations = data.lastRecommendations;

  // ── Build and send prompt to LLM ──
  const prompt = buildEvolutionPrompt(
    trend,
    personalizedPrompt?.compiledFragment ?? null,
    previousRecommendations,
  );

  log.debug(`Sending evolution prompt (${interactions.length} interactions, trend computed)`);

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
        temperature: 0.2,
      },
    );

    const responseText = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text.trim())
      .join("\n")
      .trim();

    if (!responseText) {
      log.warn("LLM returned empty response for evolution analysis.");
      return null;
    }

    // ── Parse JSON response ──
    const jsonStr = responseText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      log.warn(`Failed to parse evolution JSON response: ${jsonStr.slice(0, 200)}`);
      return null;
    }

    // ── Validate ──
    const effectivenessScore = Number(parsed.effectivenessScore);
    if (
      !Number.isFinite(effectivenessScore) ||
      effectivenessScore < 0 ||
      effectivenessScore > 100
    ) {
      log.warn(`Invalid effectivenessScore: ${String(parsed.effectivenessScore)}`);
      return null;
    }

    if (!Array.isArray(parsed.strengths) || !Array.isArray(parsed.improvements)) {
      log.warn("Missing strengths or improvements arrays.");
      return null;
    }

    if (typeof parsed.behavioralAdjustments !== "string" || !parsed.behavioralAdjustments) {
      log.warn("Missing or empty behavioralAdjustments.");
      return null;
    }

    if (typeof parsed.summary !== "string" || !parsed.summary) {
      log.warn("Missing or empty summary.");
      return null;
    }

    const recommendations: EvolutionRecommendations = {
      effectivenessScore: Math.round(effectivenessScore),
      strengths: (parsed.strengths as string[]).filter((s) => typeof s === "string" && s.trim()),
      improvements: (parsed.improvements as string[]).filter(
        (s) => typeof s === "string" && s.trim(),
      ),
      behavioralAdjustments: (parsed.behavioralAdjustments as string).trim(),
      summary: (parsed.summary as string).trim(),
    };

    // ── Save results ──
    data.lastTrend = trend;
    data.lastRecommendations = recommendations;
    data.effectivenessHistory.push({
      timestampMs: Date.now(),
      score: recommendations.effectivenessScore,
    });

    // Cap history length
    if (data.effectivenessHistory.length > MAX_EFFECTIVENESS_HISTORY) {
      data.effectivenessHistory = data.effectivenessHistory.slice(-MAX_EFFECTIVENESS_HISTORY);
    }

    tracker.setData(data);

    log.info(
      `Evolution analysis complete: effectiveness=${recommendations.effectivenessScore}/100, ` +
        `strengths=${recommendations.strengths.length}, improvements=${recommendations.improvements.length}`,
    );

    return recommendations;
  } catch (err) {
    log.error(`Evolution analysis LLM call failed: ${String(err)}`);
    return null;
  }
}

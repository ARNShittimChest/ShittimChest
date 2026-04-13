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

### Questions to evaluate:
1. Is Sensei actively engaged? (high senseiIntensity = engaged, low = distracted/uninterested)
2. Is the relationship improving or declining? (affection trajectory)
3. Is Arona's emotional range appropriate? (mood variety — <20% = monotonous, >80% = chaotically unstable, 30-60% = healthy)
4. Are proactive messages well-received? (proactive engagement rate if available)
5. Is response length appropriate? (very long responses for casual chat = bad, short responses for complex topics = bad)
6. What specific behavioral changes would improve things?

### effectivenessScore calibration:
- 0-20: Relationship is deteriorating. Sensei is disengaged, affection declining, conversations feel forced
- 21-40: Below average. Some connection but significant issues — wrong tone, repetitive, or missing Sensei's emotional needs
- 41-60: Acceptable. Functional conversations but room for improvement — average engagement, no strong bonding moments
- 61-80: Good. Sensei is engaged, affection stable/growing, some genuine connection moments. Minor refinements possible
- 81-100: Excellent. Strong bond, high engagement, Arona adapts well to Sensei's needs. Reserve 90+ for truly exceptional metrics

### Output quality rules:
- strengths: Each item must cite SPECIFIC evidence. BAD: "Good communication". GOOD: "Matched Sensei's playful tone in 80% of interactions, leading to higher engagement"
- improvements: Each item must be ACTIONABLE. BAD: "Be more engaging". GOOD: "Reduce response length for casual chat from avg 150 chars to 80 chars — Sensei's own messages average 40 chars"
- behavioralAdjustments: Concise paragraph (max 100 words) written as direct instructions to Arona. Must be specific enough that Arona can act on them immediately
- summary: One sentence capturing the overall trajectory and key insight
- Write in the language that appears most frequently in the interaction data (detect from context)

## Output Format
Respond with ONLY valid JSON (no markdown fences, no commentary):
{
  "effectivenessScore": <0-100>,
  "strengths": ["evidence-based strength 1", "evidence-based strength 2"],
  "improvements": ["actionable improvement 1", "actionable improvement 2"],
  "behavioralAdjustments": "direct instructions to Arona...",
  "summary": "one-sentence trajectory summary"
}

Example output:
{
  "effectivenessScore": 68,
  "strengths": ["Sensei engagement score is 72% — above average, indicating Arona holds attention well", "Mood variety at 45% is healthy — appropriate emotional range without being chaotic"],
  "improvements": ["Avg response length (210 chars) is too long for a Sensei whose messages average 50 chars — aim for 80-120 chars in casual chat", "Affection delta averages only +0.3/turn — create more memorable moments through callbacks to shared history"],
  "behavioralAdjustments": "Shorten casual replies to 1-2 sentences. Reference specific memories when appropriate. When Sensei shares achievements, match their energy with genuine excitement rather than generic praise. If engagement drops below 50%, switch to asking questions rather than making statements.",
  "summary": "Relationship is stable with good engagement but responses are too verbose for this Sensei's conversational style."
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

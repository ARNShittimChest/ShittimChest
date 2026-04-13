/**
 * Interaction Tracker — Passive metrics collection for the Self-Evolution system.
 *
 * Collects one InteractionMetric per chat turn from self-reflection data.
 * Zero LLM cost — all data comes from the existing <arona_feelings> block.
 *
 * Storage: `.arona/evolution-metrics.json` (atomic writes, 7-day rolling window).
 */

import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { InteractionMetric, EvolutionData, EvolutionTrend } from "./types.js";
import {
  EVOLUTION_METRICS_FILE,
  EVOLUTION_DATA_VERSION,
  EVOLUTION_RETENTION_DAYS,
  MAX_EFFECTIVENESS_HISTORY,
  MIN_INTERACTIONS_FOR_ANALYSIS,
} from "./types.js";

const log = createSubsystemLogger("evolution:tracker");

// ── Singleton ────────────────────────────────────────────────────

let singletonTracker: InteractionTracker | null = null;

export function getInteractionTracker(workspaceDir: string): InteractionTracker {
  if (!singletonTracker || singletonTracker.workspaceDir !== workspaceDir) {
    singletonTracker = new InteractionTracker(workspaceDir);
  }
  return singletonTracker;
}

// ── File I/O ─────────────────────────────────────────────────────

function resolveMetricsPath(workspaceDir: string): string {
  return path.join(workspaceDir, ".arona", EVOLUTION_METRICS_FILE);
}

function loadEvolutionData(workspaceDir: string): EvolutionData {
  try {
    const raw = fs.readFileSync(resolveMetricsPath(workspaceDir), "utf-8");
    const parsed = JSON.parse(raw) as EvolutionData;
    if (parsed.version === EVOLUTION_DATA_VERSION) {
      return parsed;
    }
  } catch {
    // First run or corrupted file — return defaults
  }
  return {
    recentInteractions: [],
    lastTrend: null,
    lastRecommendations: null,
    effectivenessHistory: [],
    version: 1,
  };
}

function saveEvolutionData(workspaceDir: string, data: EvolutionData): void {
  const filePath = resolveMetricsPath(workspaceDir);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(data, null, 2) + "\n";
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, payload, "utf-8");
  fs.renameSync(tmpPath, filePath); // Atomic on POSIX
}

// ── Core Class ───────────────────────────────────────────────────

export class InteractionTracker {
  readonly workspaceDir: string;
  private data: EvolutionData;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
    this.data = loadEvolutionData(workspaceDir);
  }

  /** Reload data from disk (e.g., after dreaming modifies it). */
  reload(): void {
    this.data = loadEvolutionData(this.workspaceDir);
  }

  /**
   * Record a single interaction metric. Called after each chat turn.
   * Auto-prunes entries older than EVOLUTION_RETENTION_DAYS.
   */
  recordInteraction(metric: Omit<InteractionMetric, "timestampMs">): void {
    const now = Date.now();
    const entry: InteractionMetric = {
      ...metric,
      timestampMs: now,
    };

    this.data.recentInteractions.push(entry);

    // ── Prune old entries ──
    const cutoffMs = now - EVOLUTION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    this.data.recentInteractions = this.data.recentInteractions.filter(
      (m) => m.timestampMs >= cutoffMs,
    );

    // ── Save (non-blocking via setTimeout to avoid blocking chat response) ──
    const snapshot = { ...this.data };
    setTimeout(() => {
      try {
        saveEvolutionData(this.workspaceDir, snapshot);
      } catch (err) {
        log.warn(`Failed to save evolution metrics: ${String(err)}`);
      }
    }, 0);
  }

  /** Get recent interactions, optionally filtered to last N days. */
  getRecentInteractions(sinceDaysAgo?: number): InteractionMetric[] {
    if (sinceDaysAgo == null) {
      return [...this.data.recentInteractions];
    }
    const cutoffMs = Date.now() - sinceDaysAgo * 24 * 60 * 60 * 1000;
    return this.data.recentInteractions.filter((m) => m.timestampMs >= cutoffMs);
  }

  /** Get the full persisted data (for evolution-analyzer to read/write). */
  getData(): EvolutionData {
    return this.data;
  }

  /** Replace data and save (used by evolution-analyzer after dreaming). */
  setData(data: EvolutionData): void {
    this.data = data;
    saveEvolutionData(this.workspaceDir, data);
  }

  /**
   * Compute an EvolutionTrend from recent interactions.
   * Pure function — no LLM calls.
   * Returns null if insufficient data.
   */
  computeTrend(): EvolutionTrend | null {
    const interactions = this.data.recentInteractions;
    if (interactions.length < MIN_INTERACTIONS_FOR_ANALYSIS) {
      return null;
    }

    const now = Date.now();
    const periodStartMs = Math.min(...interactions.map((m) => m.timestampMs));
    const periodEndMs = Math.max(...interactions.map((m) => m.timestampMs));

    // ── Basic averages ──
    const avgAffectionDelta =
      interactions.reduce((sum, m) => sum + m.affectionDelta, 0) / interactions.length;

    const avgResponseLength =
      interactions.reduce((sum, m) => sum + m.responseLength, 0) / interactions.length;

    const engagementScore = Math.min(
      1,
      interactions.reduce((sum, m) => sum + m.senseiIntensity, 0) / interactions.length,
    );

    // ── Affection trajectory (simple linear regression on daily averages) ──
    const affectionTrajectory = computeAffectionTrajectory(interactions);

    // ── Dominant moods (mode) ──
    const dominantSenseiMood = computeMode(interactions.map((m) => m.senseiMood));
    const dominantAronaMood = computeMode(interactions.map((m) => m.aronaMood));

    // ── Mood variety (unique moods / possible richness) ──
    const allSenseiMoods = new Set(interactions.map((m) => m.senseiMood));
    const allAronaMoods = new Set(interactions.map((m) => m.aronaMood));
    const totalUniqueMoods = allSenseiMoods.size + allAronaMoods.size;
    // 14 possible moods × 2 sides = 28 max, but realistically cap at 20
    const moodVariety = Math.min(1, totalUniqueMoods / 20);

    // ── Proactive engagement rate ──
    const proactiveInteractions = interactions.filter((m) => m.isProactive);
    let proactiveEngagementRate: number | undefined;
    if (proactiveInteractions.length >= 3) {
      const engaged = proactiveInteractions.filter((m) => m.senseiIntensity > 0.3);
      proactiveEngagementRate = engaged.length / proactiveInteractions.length;
    }

    return {
      periodStartMs,
      periodEndMs,
      interactionCount: interactions.length,
      avgAffectionDelta,
      affectionTrajectory,
      dominantSenseiMood,
      dominantAronaMood,
      avgResponseLength: Math.round(avgResponseLength),
      engagementScore: Math.round(engagementScore * 100) / 100,
      moodVariety: Math.round(moodVariety * 100) / 100,
      proactiveEngagementRate:
        proactiveEngagementRate != null
          ? Math.round(proactiveEngagementRate * 100) / 100
          : undefined,
    };
  }

  /**
   * Build a short context string for system prompt injection.
   * Returns undefined if insufficient data.
   */
  buildEvolutionContext(): string | undefined {
    const interactions = this.data.recentInteractions;
    if (interactions.length < 3) {
      return undefined;
    }

    const trend = this.computeTrend();
    const recs = this.data.lastRecommendations;

    const lines: string[] = ["## Arona's Self-Awareness"];

    if (trend) {
      const trajectoryLabel =
        trend.affectionTrajectory > 0.1
          ? "improving"
          : trend.affectionTrajectory < -0.1
            ? "declining"
            : "stable";

      const scoreLabel = recs ? ` (effectiveness score: ${recs.effectivenessScore}/100)` : "";

      lines.push(
        `Over the past ${EVOLUTION_RETENTION_DAYS} days (${interactions.length} interactions):`,
        `- Affection trend: ${trajectoryLabel}${scoreLabel}`,
        `- Sensei usually feels: ${trend.dominantSenseiMood} (engagement: ${(trend.engagementScore * 100).toFixed(0)}%)`,
        `- Emotional variety: ${(trend.moodVariety * 100).toFixed(0)}%`,
      );

      if (trend.proactiveEngagementRate != null) {
        lines.push(
          `- Sensei's response rate to proactive messages: ${(trend.proactiveEngagementRate * 100).toFixed(0)}%`,
        );
      }
    }

    if (recs?.behavioralAdjustments?.trim()) {
      lines.push("", "Arona should keep in mind:", recs.behavioralAdjustments.trim());
    }

    return lines.join("\n");
  }
}

// ── Helper Functions ─────────────────────────────────────────────

/** Compute mode (most frequent value) of a string array. */
function computeMode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let maxCount = 0;
  let mode = values[0] ?? "neutral";
  for (const [value, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mode = value;
    }
  }
  return mode;
}

/**
 * Compute affection trajectory via simple linear regression
 * on daily average affection deltas.
 *
 * Positive slope = relationship improving, negative = declining.
 */
function computeAffectionTrajectory(interactions: InteractionMetric[]): number {
  // Group by day
  const dayMap = new Map<string, number[]>();
  for (const m of interactions) {
    const dayKey = new Date(m.timestampMs).toISOString().slice(0, 10);
    const existing = dayMap.get(dayKey);
    if (existing) {
      existing.push(m.affectionDelta);
    } else {
      dayMap.set(dayKey, [m.affectionDelta]);
    }
  }

  const dailyAvgs = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, deltas]) => deltas.reduce((s, d) => s + d, 0) / deltas.length);

  if (dailyAvgs.length < 2) {
    return 0;
  }

  // Simple linear regression: y = ax + b, return a (slope)
  const n = dailyAvgs.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += dailyAvgs[i]!;
    sumXY += i * dailyAvgs[i]!;
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) {
    return 0;
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  return Math.round(slope * 1000) / 1000; // 3 decimal places
}

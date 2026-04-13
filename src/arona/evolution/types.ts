/**
 * Types for the Self-Evolution system.
 *
 * Arona passively collects interaction metrics from every chat turn (zero LLM cost),
 * then analyzes trends during the nightly dreaming cycle to generate behavioral
 * recommendations that feed back into the personalized system prompt.
 */

// ── Interaction Metrics ──────────────────────────────────────────

/** Single interaction metric — collected after each chat turn from self-reflection data. */
export interface InteractionMetric {
  /** Unix timestamp ms */
  timestampMs: number;
  /** Arona's mood after this turn */
  aronaMood: string;
  /** Arona's mood intensity 0-1 */
  aronaIntensity: number;
  /** Perceived Sensei mood */
  senseiMood: string;
  /** Perceived Sensei mood intensity 0-1 */
  senseiIntensity: number;
  /** Affection change this turn (-10 to +10) */
  affectionDelta: number;
  /** Arona's response length (chars) — tracks verbosity preferences */
  responseLength: number;
  /** Was this a proactive message turn? */
  isProactive?: boolean;
  /** Proactive window key if applicable (morning/lunch/evening/late-night/nudge) */
  proactiveWindowKey?: string;
}

// ── Trend Analysis ───────────────────────────────────────────────

/** Aggregated trend data — computed during dreaming from recent interactions. */
export interface EvolutionTrend {
  /** Analysis period start (ms) */
  periodStartMs: number;
  /** Analysis period end (ms) */
  periodEndMs: number;
  /** Number of interactions analyzed */
  interactionCount: number;
  /** Average affection delta per turn */
  avgAffectionDelta: number;
  /** Affection trajectory: positive = growing closer, negative = drifting apart */
  affectionTrajectory: number;
  /** Most common Sensei mood during this period */
  dominantSenseiMood: string;
  /** Most common Arona mood during this period */
  dominantAronaMood: string;
  /** Average response length (chars) */
  avgResponseLength: number;
  /** Sensei engagement score 0-1 (based on senseiIntensity trends) */
  engagementScore: number;
  /** Mood variety index 0-1 (higher = more varied interactions, healthier) */
  moodVariety: number;
  /** Proactive message response rate if applicable */
  proactiveEngagementRate?: number;
}

// ── LLM Recommendations ─────────────────────────────────────────

/** LLM-generated evolution recommendations (produced during dreaming Phase 4). */
export interface EvolutionRecommendations {
  /** Overall effectiveness score 0-100 */
  effectivenessScore: number;
  /** What Arona is doing well */
  strengths: string[];
  /** What needs improvement */
  improvements: string[];
  /** Specific behavioral adjustments (fed to prompt optimizer context) */
  behavioralAdjustments: string;
  /** Short summary for logging */
  summary: string;
}

// ── Persisted State ──────────────────────────────────────────────

/** Persisted evolution state in .arona/evolution-metrics.json */
export interface EvolutionData {
  /** Rolling 7-day interaction log (older entries auto-pruned) */
  recentInteractions: InteractionMetric[];
  /** Last computed trend (from dreaming analysis) */
  lastTrend: EvolutionTrend | null;
  /** Last LLM-generated recommendations (from dreaming analysis) */
  lastRecommendations: EvolutionRecommendations | null;
  /** History of effectiveness scores for long-term tracking (max entries capped) */
  effectivenessHistory: Array<{ timestampMs: number; score: number }>;
  /** Schema version for future migration */
  version: 1;
}

// ── Constants ────────────────────────────────────────────────────

export const EVOLUTION_METRICS_FILE = "evolution-metrics.json";
export const EVOLUTION_DATA_VERSION = 1;

/** Max days of interaction data to keep */
export const EVOLUTION_RETENTION_DAYS = 7;
/** Max effectiveness history entries */
export const MAX_EFFECTIVENESS_HISTORY = 30;
/** Minimum interactions needed for meaningful trend analysis */
export const MIN_INTERACTIONS_FOR_ANALYSIS = 10;

/**
 * Types for the Arona Dreaming system.
 *
 * Dreaming is a nightly process that:
 * 1. Consolidates chat memories (via memory-reflect)
 * 2. Refreshes the Sensei personality profile (via sensei-profiler)
 * 3. Optimizes Arona's system prompt per-user based on accumulated data
 */

// ── Dreaming State ────────────────────────────────────────────────

export type DreamPhase = "idle" | "memory" | "profile" | "optimize" | "done";

export interface DreamingState {
  /** Whether a dreaming cycle is currently running */
  isDreaming: boolean;
  /** When the current/last dream cycle started (ms) */
  startedAtMs: number;
  /** Current phase of the dream cycle */
  phase: DreamPhase;
  /** When the last successful dream completed (ms) */
  lastDreamAtMs: number;
  /** Error message if the last dream failed */
  error?: string;
}

// ── Personalized Prompt ───────────────────────────────────────────

export interface PersonalizedPrompt {
  /** Schema version for migration safety */
  version: number;
  /** When this prompt was generated (ms) */
  generatedAtMs: number;
  /** Agent ID this prompt was generated for */
  agentId: string;

  // ── Per-user prompt adjustments extracted from conversations ──

  /** How Arona should adjust her tone for this Sensei */
  toneAdjustments: string;
  /** Topics Sensei enjoys or avoids */
  topicPreferences: string;
  /** Communication style preferences (length, formality, emoji, language) */
  communicationStyle: string;
  /** Personal context (schedule patterns, emotional needs, encouragement style) */
  personalContext: string;
  /** What Arona should NOT do with this Sensei */
  avoidPatterns: string;

  /** Compiled prompt fragment ready for injection (max ~200 words) */
  compiledFragment: string;
}

// ── Dream Report ──────────────────────────────────────────────────

export interface DreamReport {
  /** Number of chat_log entries processed during memory consolidation */
  memoriesConsolidated: number;
  /** Number of sensei_profile entries updated/created */
  profileUpdates: number;
  /** Summary of prompt personalization changes */
  promptChanges: string[];
  /** Total dreaming duration (ms) */
  durationMs: number;
  /** Per-phase results */
  phases: {
    memory: { ok: boolean; error?: string };
    profile: { ok: boolean; error?: string };
    optimize: { ok: boolean; error?: string };
  };
}

// ── Constants ─────────────────────────────────────────────────────

export const PERSONALIZED_PROMPT_FILE = "personalized-prompt.json";
export const DREAMING_STATE_FILE = "dreaming-state.json";
export const PERSONALIZED_PROMPT_VERSION = 1;

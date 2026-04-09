/**
 * Companion module — Arona/Plana Emotional State Engine.
 *
 * Re-exports all companion functionality for convenient imports.
 */

export {
  createInitialState,
  applyTrigger,
  decayMood,
  buildMoodPromptContext,
  addAffectionPoints,
  applySelfReflection,
  getAffectionLevel,
  getAffectionPromptModifier,
} from "./emotional-state.js";
export type {
  Mood,
  EmotionalState,
  MoodTrigger,
  AffectionLevel,
  SelfReflectionResult,
} from "./emotional-state.js";

export {
  analyzeTimeOfDay,
  analyzeKeywords,
  analyzeAbsence,
  analyzeInteraction,
  createEventTrigger,
  getLocalHour,
  getTimeMode,
  buildTimeModePromptHint,
  analyzeAffectionDelta,
  getAbsenceAffectionDelta,
  INTERACTION_AFFECTION_DELTA,
} from "./mood-triggers.js";
export type { TimeMode } from "./mood-triggers.js";

export { saveMoodState, loadMoodState, loadOrCreateMoodState } from "./mood-persistence.js";

// ── Deprecated: External affection analyzer ──────────────────────
// These are no longer used in the main pipeline. The main LLM now
// self-evaluates via <arona_feelings> blocks (see self-reflection.ts).
// Kept for backward compatibility with external plugins/hooks.
export {
  analyzeAffectionWithAI,
  aiResultToMoodTrigger,
  resolveAnalysisConfig,
} from "./affection-analyzer.js";
export type { AffectionAnalysisConfig, AffectionAnalysisResult } from "./affection-analyzer.js";

export { extractSelfReflection } from "./self-reflection.js";
export type { SelfReflectionParseResult } from "./self-reflection.js";

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
  getAffectionLevel,
  getAffectionPromptModifier,
} from "./emotional-state.js";
export type { Mood, EmotionalState, MoodTrigger, AffectionLevel } from "./emotional-state.js";

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

export {
  analyzeAffectionWithAI,
  aiResultToMoodTrigger,
  resolveAnalysisConfig,
} from "./affection-analyzer.js";
export type { AffectionAnalysisConfig, AffectionAnalysisResult } from "./affection-analyzer.js";

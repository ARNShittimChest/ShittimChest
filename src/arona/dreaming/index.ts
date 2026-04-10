/**
 * Arona Dreaming — Nightly memory consolidation & prompt personalization.
 *
 * Public API:
 * - startDreamingScheduler() — Start the nightly dreaming scheduler
 * - runDreaming() — Execute the full dreaming cycle (manual trigger)
 * - loadPersonalizedPrompt() — Load saved personalized prompt for injection
 * - Types — DreamReport, PersonalizedPrompt, DreamingState, etc.
 */

export { runDreaming } from "./orchestrator.js";
export type { DreamingOptions } from "./orchestrator.js";
export { loadPersonalizedPrompt } from "./prompt-optimizer.js";
export { startDreamingScheduler } from "./scheduler.js";
export type { DreamingSchedulerHandle, DreamingSchedulerOptions } from "./scheduler.js";
export type { DreamReport, DreamPhase, DreamingState, PersonalizedPrompt } from "./types.js";
export {
  PERSONALIZED_PROMPT_FILE,
  DREAMING_STATE_FILE,
  PERSONALIZED_PROMPT_VERSION,
} from "./types.js";

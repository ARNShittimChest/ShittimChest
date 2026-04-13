/**
 * Dreaming Scheduler — Manages the nightly dreaming cycle timing.
 *
 * Similar to mood-ticker.ts: a simple timer that checks if it's time
 * to dream, and runs the orchestrator when conditions are met.
 *
 * Runs every 30 minutes; triggers dreaming between 2-4 AM local time
 * if no dream has occurred in the last 20 hours.
 */

import type { ShittimChestConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { resolveDefaultAgentWorkspaceDir } from "../../agents/workspace.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { runDreaming } from "./orchestrator.js";
import type { DreamingState, DreamReport } from "./types.js";
import { DREAMING_STATE_FILE } from "./types.js";
import fs from "node:fs";
import path from "node:path";

const log = createSubsystemLogger("dreaming:scheduler");

/** Check every 30 minutes if it's time to dream */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Minimum hours between dream cycles */
const MIN_DREAM_INTERVAL_HOURS = 20;

/** Dream window: 2:00 AM - 4:00 AM local time (mutable — updated by habit learning) */
let dreamWindowStartHour = 2;
let dreamWindowEndHour = 4;

/**
 * Update the dream window hours based on learned user schedule.
 * Dreams should happen 3-5 hours after sleep (deep sleep phase).
 * Takes effect on the next periodic check — no restart needed.
 */
export function updateDreamWindow(startHour: number, endHour: number): void {
  dreamWindowStartHour = startHour;
  dreamWindowEndHour = endHour;
  log.info(`Dream window updated: ${startHour}:00–${endHour}:00`);
}

// ── Types ─────────────────────────────────────────────────────────

export interface DreamingSchedulerOptions {
  /** Initial config (reloaded at runtime for fresh values) */
  cfg: ShittimChestConfig;
  /** Called when mood updates during dreaming (for broadcasting) */
  onMoodUpdate?: (state: import("../../companion/emotional-state.js").EmotionalState) => void;
  /** Called when dreaming completes with a report */
  onDreamComplete?: (report: DreamReport) => void;
}

export interface DreamingSchedulerHandle {
  /** Stop the scheduler and clean up timers */
  stop: () => void;
  /** Force an immediate dream cycle (bypasses time window and interval checks) */
  triggerNow: () => Promise<DreamReport>;
}

// ── Helpers ───────────────────────────────────────────────────────

function loadDreamingState(workspaceDir: string): DreamingState | null {
  try {
    const filePath = path.join(workspaceDir, ".arona", DREAMING_STATE_FILE);
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as DreamingState;
  } catch {
    return null;
  }
}

function isInDreamWindow(): boolean {
  const hour = new Date().getHours();
  // Handle wrap-around (e.g., startHour=1, endHour=3 or startHour=25 wrapping)
  if (dreamWindowStartHour < dreamWindowEndHour) {
    return hour >= dreamWindowStartHour && hour < dreamWindowEndHour;
  }
  // Wrap-around case (e.g., start=23, end=2 → 23,0,1 are valid)
  return hour >= dreamWindowStartHour || hour < dreamWindowEndHour;
}

function shouldDream(workspaceDir: string): boolean {
  // Must be in the dream window (2-4 AM)
  if (!isInDreamWindow()) return false;

  // Check last dream time
  const state = loadDreamingState(workspaceDir);
  if (!state?.lastDreamAtMs) return true; // Never dreamed before

  const hoursSinceLastDream = (Date.now() - state.lastDreamAtMs) / (1000 * 60 * 60);
  return hoursSinceLastDream >= MIN_DREAM_INTERVAL_HOURS;
}

// ── Main ──────────────────────────────────────────────────────────

export function startDreamingScheduler(opts: DreamingSchedulerOptions): DreamingSchedulerHandle {
  let stopped = false;
  let timerId: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const runDreamCycle = async (force = false): Promise<DreamReport> => {
    if (running) {
      log.info("Dream cycle already running, skipping.");
      return {
        memoriesConsolidated: 0,
        profileUpdates: 0,
        promptChanges: ["Skipped — already running"],
        durationMs: 0,
        phases: {
          memory: { ok: false, error: "already running" },
          profile: { ok: false, error: "already running" },
          optimize: { ok: false, error: "already running" },
        },
      };
    }

    running = true;
    try {
      // Reload config at runtime for fresh model/API key settings
      const cfg = loadConfig();
      const agentId = resolveDefaultAgentId(cfg);
      const workspaceDir = resolveDefaultAgentWorkspaceDir();

      log.info(`Dreaming cycle triggered (force=${force})`);

      const report = await runDreaming(cfg, agentId, workspaceDir, {
        force,
        onMoodUpdate: opts.onMoodUpdate,
        onPhaseChange: (phase) => {
          log.debug(`Dream phase: ${phase}`);
        },
      });

      opts.onDreamComplete?.(report);
      return report;
    } catch (err) {
      log.error(`Dreaming cycle failed: ${String(err)}`);
      throw err;
    } finally {
      running = false;
    }
  };

  const tick = () => {
    if (stopped) return;

    try {
      const cfg = loadConfig();
      const agentId = resolveDefaultAgentId(cfg);
      const workspaceDir = resolveDefaultAgentWorkspaceDir();

      if (shouldDream(workspaceDir)) {
        log.info("Dream window active and conditions met — starting dream cycle");
        void runDreamCycle(false).catch((err) => {
          log.error(`Scheduled dream cycle failed: ${String(err)}`);
        });
      }
    } catch (err) {
      log.debug(`Dream check failed: ${String(err)}`);
    }
  };

  // Start periodic checks
  timerId = setInterval(tick, CHECK_INTERVAL_MS);
  timerId.unref();
  // Also check immediately on startup (in case we're already in the dream window)
  const initialTimer = setTimeout(tick, 5000);
  initialTimer.unref();

  log.info(
    `Dreaming scheduler started (check every ${CHECK_INTERVAL_MS / 60000}min, window ${dreamWindowStartHour}:00-${dreamWindowEndHour}:00)`,
  );

  return {
    stop: () => {
      stopped = true;
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      log.info("Dreaming scheduler stopped");
    },
    triggerNow: () => runDreamCycle(true),
  };
}

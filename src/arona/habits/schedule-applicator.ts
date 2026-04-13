/**
 * arona/habits/schedule-applicator.ts
 *
 * Propagates a resolved user schedule to all timing-sensitive subsystems:
 *   - Health reminders (activeStart / activeEnd)
 *   - Proactive scheduler (time windows + nudge range)
 *   - Dreaming scheduler (dream window)
 *
 * Called on boot (if learned/explicit schedule exists) and after
 * schedule changes (explicit override or new learning).
 */

import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { ResolvedSchedule } from "./types.js";
import { updateReminderConfig } from "../health/health-config.js";
import { updateProactiveSchedule } from "../proactive/scheduler.js";
import { updateDreamWindow } from "../dreaming/scheduler.js";

const log = createSubsystemLogger("habit-applicator");

// ── Subsystem Handles ───────────────────────────────────────────

/** Handles to subsystems that can be updated at runtime. */
export interface SubsystemHandles {
  /** Health scheduler handle with restart() */
  healthRestart?: () => void;
  /** Proactive scheduler restart (set after modification) */
  proactiveRestart?: () => void;
}

/** Module-level handles — set once from server.impl boot. */
let handles: SubsystemHandles = {};

/** Register subsystem handles for runtime updates. */
export function setSubsystemHandles(h: SubsystemHandles): void {
  handles = { ...handles, ...h };
}

// ── Apply Schedule ──────────────────────────────────────────────

/**
 * Push a resolved schedule to all timing-sensitive subsystems.
 *
 * This is idempotent — calling multiple times with the same schedule
 * produces the same effect.
 */
export function applyScheduleToSubsystems(
  schedule: ResolvedSchedule,
  opts?: { skipHealth?: boolean; skipProactive?: boolean; skipDreaming?: boolean },
): void {
  const { wakeHour, sleepHour, source, confidence } = schedule;
  const wakeInt = Math.round(wakeHour);
  const sleepInt = Math.round(sleepHour);

  log.info(
    `Applying schedule: wake=${wakeInt}h, sleep=${sleepInt}h (source=${source}, confidence=${confidence.toFixed(2)})`,
  );

  // ── 1. Health reminders ────────────────────────────────────
  if (!opts?.skipHealth) {
    try {
      // Water: active during waking hours
      updateReminderConfig("water", {
        activeStart: wakeInt,
        activeEnd: sleepInt,
      });

      // Eyes: extend 1 hour past sleep (late-night screen time)
      updateReminderConfig("eyes", {
        activeStart: wakeInt,
        activeEnd: Math.min(sleepInt + 1, 23),
      });

      // Movement: active during waking hours
      updateReminderConfig("movement", {
        activeStart: wakeInt,
        activeEnd: sleepInt,
      });

      // Sleep: fire reminder at sleep hour
      updateReminderConfig("sleep", {
        activeStart: Math.max(sleepInt - 1, 0),
        activeEnd: sleepInt,
      });

      // Restart health scheduler to pick up changes
      handles.healthRestart?.();
      log.debug("Health reminders updated");
    } catch (err) {
      log.debug(`Failed to update health reminders: ${String(err)}`);
    }
  }

  // ── 2. Proactive scheduler ─────────────────────────────────
  if (!opts?.skipProactive) {
    try {
      updateProactiveSchedule(wakeHour, sleepHour);
      handles.proactiveRestart?.();
      log.debug("Proactive schedule updated");
    } catch (err) {
      log.debug(`Failed to update proactive schedule: ${String(err)}`);
    }
  }

  // ── 3. Dreaming scheduler ──────────────────────────────────
  if (!opts?.skipDreaming) {
    try {
      // Dreams happen 3-5 hours after sleep (deep sleep phase)
      const dreamStart = (sleepInt + 3) % 24;
      const dreamEnd = (sleepInt + 5) % 24;
      updateDreamWindow(dreamStart, dreamEnd);
      log.debug(`Dream window updated: ${dreamStart}:00–${dreamEnd}:00`);
    } catch (err) {
      log.debug(`Failed to update dream window: ${String(err)}`);
    }
  }

  log.info("Schedule applied to all subsystems");
}

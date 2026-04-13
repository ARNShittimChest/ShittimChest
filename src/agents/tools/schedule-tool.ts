/**
 * agents/tools/schedule-tool.ts
 *
 * AI agent tool that lets Sensei tell Arona their sleep/wake schedule.
 *
 * When Sensei says things like:
 *   - "Anh thuong day luc 9h"
 *   - "Anh ngu khuya lam, 2h sang"
 *   - "Gio giac cua anh the nao?"
 *
 * Arona translates to the right parameters and calls this tool.
 * Changes are applied immediately to health reminders, proactive messages,
 * and dreaming scheduler.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, readNumberParam } from "./common.js";
import { getHabitTracker } from "../../arona/habits/habit-tracker.js";
import { applyScheduleToSubsystems } from "../../arona/habits/schedule-applicator.js";

// ── Schema ─────────────────────────────────────────────────────

const ScheduleToolSchema = Type.Object({
  action: Type.Union([Type.Literal("set"), Type.Literal("clear"), Type.Literal("status")], {
    description:
      '"set" updates wake/sleep hours. "clear" removes explicit override (falls back to learned or default). "status" shows current schedule.',
  }),
  wakeHour: Type.Optional(
    Type.Number({
      description: "Hour Sensei typically wakes up (0-23). E.g., 7 for 7:00 AM, 9.5 for 9:30 AM.",
      minimum: 0,
      maximum: 23,
    }),
  ),
  sleepHour: Type.Optional(
    Type.Number({
      description:
        "Hour Sensei typically goes to sleep (0-23). E.g., 23 for 11:00 PM, 1 for 1:00 AM.",
      minimum: 0,
      maximum: 23,
    }),
  ),
  reason: Type.Optional(
    Type.String({
      description:
        "Brief note about why this was set (e.g., what Sensei said). For audit purposes.",
    }),
  ),
});

// ── Tool Factory ───────────────────────────────────────────────

export function createScheduleTool(): AnyAgentTool {
  return {
    label: "Sensei Schedule",
    name: "set_sensei_schedule",
    description:
      "View or update Sensei's sleep/wake schedule. Arona uses this to time health reminders, " +
      "proactive messages, and dreaming appropriately. " +
      'Use action "set" when Sensei mentions their wake/sleep times, ' +
      '"clear" to remove explicit settings, "status" to check current schedule. ' +
      "Only set what Sensei explicitly mentions — don't guess unmentioned values.",
    ownerOnly: true,
    parameters: ScheduleToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const tracker = getHabitTracker();
      if (!tracker) {
        return jsonResult({
          success: false,
          error: "Habit tracker not initialized. Schedule learning is not available.",
        });
      }

      // ── STATUS ──
      if (action === "status") {
        return jsonResult({
          success: true,
          schedule: tracker.getResolvedSchedule(),
          details: tracker.buildStatusSummary(),
        });
      }

      // ── CLEAR ──
      if (action === "clear") {
        tracker.clearExplicitSchedule();
        const schedule = tracker.getResolvedSchedule();

        // Re-apply with learned/default schedule
        try {
          applyScheduleToSubsystems(schedule);
        } catch {
          // Non-critical
        }

        return jsonResult({
          success: true,
          message: "Da xoa gio giac tu dat. Arona se dung gio giac tu hoc hoac mac dinh.",
          schedule,
        });
      }

      // ── SET ──
      if (action === "set") {
        const wakeHour = readNumberParam(params, "wakeHour");
        const sleepHour = readNumberParam(params, "sleepHour");
        const reason = readStringParam(params, "reason") ?? "Sensei tu cho biet";

        if (wakeHour === undefined && sleepHour === undefined) {
          return jsonResult({
            success: false,
            error: "Can it nhat wakeHour hoac sleepHour. Chi dat nhung gi Sensei noi.",
          });
        }

        // Validate ranges
        if (wakeHour !== undefined && (wakeHour < 0 || wakeHour > 23)) {
          return jsonResult({
            success: false,
            error: "wakeHour phai tu 0 den 23.",
          });
        }
        if (sleepHour !== undefined && (sleepHour < 0 || sleepHour > 23)) {
          return jsonResult({
            success: false,
            error: "sleepHour phai tu 0 den 23.",
          });
        }

        const opts: { wakeHour?: number; sleepHour?: number } = {};
        if (wakeHour !== undefined) opts.wakeHour = wakeHour;
        if (sleepHour !== undefined) opts.sleepHour = sleepHour;

        tracker.setExplicitSchedule(opts, reason);
        const schedule = tracker.getResolvedSchedule();

        // Apply immediately to all subsystems
        try {
          applyScheduleToSubsystems(schedule);
        } catch {
          // Non-critical — log is handled inside applyScheduleToSubsystems
        }

        const parts: string[] = [];
        if (wakeHour !== undefined) parts.push(`thuc day luc ${wakeHour}h`);
        if (sleepHour !== undefined) parts.push(`di ngu luc ${sleepHour}h`);

        return jsonResult({
          success: true,
          message: `Da cap nhat gio giac: ${parts.join(", ")}. Arona se dieu chinh lich nhac nho theo.`,
          schedule,
        });
      }

      return jsonResult({
        success: false,
        error: `Unknown action "${action}". Must be one of: set, clear, status.`,
      });
    },
  };
}

/**
 * agents/tools/health-config-tool.ts
 *
 * AI agent tool that lets Sensei adjust health reminder settings through chat.
 * Arona interprets natural language requests and calls this tool to:
 *   - View current health reminder config
 *   - Toggle reminders on/off
 *   - Change intervals and active hours
 *
 * The health scheduler re-reads config on every fire, so changes take effect
 * at the next scheduled tick without requiring a restart.
 */

import { Type } from "@sinclair/typebox";
import {
  getHealthConfig,
  updateReminderConfig,
  toggleReminder,
  type HealthConfig,
} from "../../arona/health/health-config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, readNumberParam } from "./common.js";

// ── Schema ─────────────────────────────────────────────────────

const HealthConfigToolSchema = Type.Object({
  action: Type.Union([Type.Literal("get"), Type.Literal("update"), Type.Literal("toggle")], {
    description:
      'Action to perform. "get" returns current config. "update" changes settings. "toggle" enables/disables a reminder type.',
  }),
  type: Type.Optional(
    Type.Union(
      [
        Type.Literal("water"),
        Type.Literal("eyes"),
        Type.Literal("movement"),
        Type.Literal("sleep"),
      ],
      {
        description:
          'Reminder type to modify. Required for "update" and "toggle" actions. One of: water, eyes, movement, sleep.',
      },
    ),
  ),
  enabled: Type.Optional(
    Type.Boolean({
      description: 'Whether to enable or disable the reminder. Used with "toggle" action.',
    }),
  ),
  intervalMinutes: Type.Optional(
    Type.Number({
      description:
        'Interval in minutes between reminders. Used with "update" action. E.g., 90 for every 1.5 hours.',
    }),
  ),
  activeStart: Type.Optional(
    Type.Number({
      description:
        'Hour (0-23) when reminders start being active. Used with "update" action. E.g., 7 for 7:00 AM.',
    }),
  ),
  activeEnd: Type.Optional(
    Type.Number({
      description:
        'Hour (0-23) when reminders stop being active. Used with "update" action. E.g., 22 for 10:00 PM.',
    }),
  ),
});

// ── Helper ─────────────────────────────────────────────────────

function formatConfig(cfg: HealthConfig) {
  const describe = (name: string, key: keyof HealthConfig) => {
    const c = cfg[key];
    if (!c.enabled) return { name, enabled: false };
    return {
      name,
      enabled: true,
      intervalMinutes: c.intervalMinutes,
      activeHours: `${c.activeStart}:00 – ${c.activeEnd}:00`,
    };
  };
  return {
    water: describe("Water", "water"),
    eyes: describe("Eye break", "eyes"),
    movement: describe("Movement", "movement"),
    sleep: describe("Sleep", "sleep"),
  };
}

// ── Tool Factory ───────────────────────────────────────────────

export function createHealthConfigTool(): AnyAgentTool {
  return {
    label: "Health Reminders",
    name: "health_config",
    description:
      "View and modify health reminder settings (water, eye breaks, movement, sleep). " +
      'Use action "get" to see current config, "toggle" to enable/disable a reminder type, ' +
      '"update" to change interval or active hours. ' +
      "Sensei can ask in natural language — Arona translates to the right parameters.",
    ownerOnly: true,
    parameters: HealthConfigToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      // ── GET: return current config ──
      if (action === "get") {
        const cfg = getHealthConfig();
        return jsonResult({
          success: true,
          config: formatConfig(cfg),
        });
      }

      // ── TOGGLE / UPDATE: require type ──
      const type = readStringParam(params, "type", {
        required: true,
        label: "reminder type",
      }) as keyof HealthConfig;

      const validTypes = ["water", "eyes", "movement", "sleep"];
      if (!validTypes.includes(type)) {
        return jsonResult({
          success: false,
          error: `Invalid reminder type "${type}". Must be one of: ${validTypes.join(", ")}`,
        });
      }

      if (action === "toggle") {
        const enabled = params.enabled;
        if (typeof enabled !== "boolean") {
          return jsonResult({
            success: false,
            error: '"enabled" (true/false) is required for toggle action.',
          });
        }
        const updated = toggleReminder(type, enabled);
        return jsonResult({
          success: true,
          message: `${type} reminder ${enabled ? "enabled" : "disabled"}.`,
          config: formatConfig(updated),
        });
      }

      if (action === "update") {
        const updates: Record<string, unknown> = {};

        const intervalMinutes = readNumberParam(params, "intervalMinutes");
        if (intervalMinutes !== undefined) {
          if (intervalMinutes < 5 || intervalMinutes > 1440 * 7) {
            return jsonResult({
              success: false,
              error: "intervalMinutes must be between 5 and 10080 (7 days).",
            });
          }
          updates.intervalMinutes = intervalMinutes;
        }

        const activeStart = readNumberParam(params, "activeStart", { integer: true });
        if (activeStart !== undefined) {
          if (activeStart < 0 || activeStart > 23) {
            return jsonResult({
              success: false,
              error: "activeStart must be between 0 and 23.",
            });
          }
          updates.activeStart = activeStart;
        }

        const activeEnd = readNumberParam(params, "activeEnd", { integer: true });
        if (activeEnd !== undefined) {
          if (activeEnd < 0 || activeEnd > 23) {
            return jsonResult({
              success: false,
              error: "activeEnd must be between 0 and 23.",
            });
          }
          updates.activeEnd = activeEnd;
        }

        if (Object.keys(updates).length === 0) {
          return jsonResult({
            success: false,
            error:
              "No updates provided. Specify at least one of: intervalMinutes, activeStart, activeEnd.",
          });
        }

        const updated = updateReminderConfig(type, updates);
        return jsonResult({
          success: true,
          message: `${type} reminder updated.`,
          changes: updates,
          config: formatConfig(updated),
        });
      }

      return jsonResult({
        success: false,
        error: `Unknown action "${action}". Must be one of: get, update, toggle.`,
      });
    },
  };
}

/**
 * arona/health/health-config.ts
 *
 * Persistent user preferences for health reminders.
 * Sensei can configure intervals and toggle reminders on/off through chat.
 * Arona saves preferences using memory_search and this config file.
 *
 * Storage: `.arona/health-config.json` (atomic write — tmp file + rename).
 */

import fs from "node:fs";
import path from "node:path";

// ── Types ────────────────────────────────────────────────────────

export interface HealthReminderConfig {
  /** Whether this reminder type is enabled. */
  enabled: boolean;
  /** Interval in minutes between reminders. */
  intervalMinutes: number;
  /** Active hours range (24h format). */
  activeStart: number;
  activeEnd: number;
}

export interface HealthConfig {
  water: HealthReminderConfig;
  eyes: HealthReminderConfig;
  movement: HealthReminderConfig;
  sleep: HealthReminderConfig;
}

// ── Defaults ────────────────────────────────────────────────────

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  water: {
    enabled: true,
    intervalMinutes: 120,
    activeStart: 7,
    activeEnd: 22,
  },
  eyes: {
    enabled: true,
    intervalMinutes: 45,
    activeStart: 7,
    activeEnd: 23,
  },
  movement: {
    enabled: true,
    intervalMinutes: 180,
    activeStart: 7,
    activeEnd: 22,
  },
  sleep: {
    enabled: true,
    intervalMinutes: 1440, // once per day
    activeStart: 22,
    activeEnd: 23,
  },
};

// ── In-memory state ─────────────────────────────────────────────

let config: HealthConfig | null = null;
let configPath: string | null = null;

// ── Persistence ─────────────────────────────────────────────────

function saveToDisk(): void {
  if (!configPath || !config) return;
  try {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${configPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, configPath);
  } catch {
    // Best-effort
  }
}

function loadFromDisk(): void {
  if (!configPath) return;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<HealthConfig>;
    // Merge with defaults to handle missing fields after schema evolution
    config = {
      water: { ...DEFAULT_HEALTH_CONFIG.water, ...parsed.water },
      eyes: { ...DEFAULT_HEALTH_CONFIG.eyes, ...parsed.eyes },
      movement: { ...DEFAULT_HEALTH_CONFIG.movement, ...parsed.movement },
      sleep: { ...DEFAULT_HEALTH_CONFIG.sleep, ...parsed.sleep },
    };
  } catch {
    config = { ...DEFAULT_HEALTH_CONFIG };
  }
}

// ── Public API ──────────────────────────────────────────────────

/** Initialize the health config. Call once at startup. */
export function initHealthConfig(workspaceDir: string): void {
  configPath = path.join(workspaceDir, ".arona", "health-config.json");
  loadFromDisk();
}

/** Get the current health config (returns defaults if not initialized). */
export function getHealthConfig(): HealthConfig {
  return config ?? { ...DEFAULT_HEALTH_CONFIG };
}

/** Update a specific reminder type. Returns the updated config. */
export function updateReminderConfig(
  type: keyof HealthConfig,
  updates: Partial<HealthReminderConfig>,
): HealthConfig {
  if (!config) config = { ...DEFAULT_HEALTH_CONFIG };
  config[type] = { ...config[type], ...updates };
  saveToDisk();
  return config;
}

/** Toggle a reminder on/off. */
export function toggleReminder(type: keyof HealthConfig, enabled: boolean): HealthConfig {
  return updateReminderConfig(type, { enabled });
}

/** Build a summary of health config for system prompt injection. */
export function buildHealthConfigSummary(): string {
  const cfg = getHealthConfig();
  const lines: string[] = ["[Health Reminder Settings]"];

  const describe = (name: string, c: HealthReminderConfig): string => {
    if (!c.enabled) return `- ${name}: OFF`;
    return `- ${name}: every ${c.intervalMinutes}min (${c.activeStart}:00-${c.activeEnd}:00)`;
  };

  lines.push(describe("Water", cfg.water));
  lines.push(describe("Eye break", cfg.eyes));
  lines.push(describe("Movement", cfg.movement));
  lines.push(describe("Sleep", cfg.sleep));
  lines.push("");
  lines.push(
    "Sensei can adjust these by telling Arona, e.g. 'nhắc uống nước mỗi 1.5 tiếng' or 'turn off eye break reminders'.",
  );

  return lines.join("\n");
}

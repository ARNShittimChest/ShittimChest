/**
 * arona/health/health-config.ts
 *
 * Persistent user preferences for health reminders.
 * Sensei can configure intervals and toggle reminders on/off through chat.
 * Arona saves preferences using memory_search and this config file.
 *
 * Also tracks recently sent reminders so Arona knows context when Sensei replies.
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
  /** Whether to ping a specific IP before sending. If ping fails, the reminder is skipped. */
  requirePing?: boolean;
  /** The IPv4 or hostname to ping. */
  pingIp?: string;
}

export interface HealthConfig {
  water: HealthReminderConfig;
  eyes: HealthReminderConfig;
  movement: HealthReminderConfig;
  sleep: HealthReminderConfig;
}

/** A record of a recently sent health reminder. */
export interface SentReminder {
  /** Reminder type (water, eyes, movement, sleep). */
  type: string;
  /** The notification text that was sent. */
  text: string;
  /** When it was sent (epoch ms). */
  sentAt: number;
}

// ── Defaults ────────────────────────────────────────────────────

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  water: {
    enabled: true,
    intervalMinutes: 120,
    activeStart: 7,
    activeEnd: 22,
    requirePing: false,
    pingIp: "",
  },
  eyes: {
    enabled: true,
    intervalMinutes: 45,
    activeStart: 7,
    activeEnd: 23,
    requirePing: false,
    pingIp: "",
  },
  movement: {
    enabled: true,
    intervalMinutes: 180,
    activeStart: 7,
    activeEnd: 22,
    requirePing: false,
    pingIp: "",
  },
  sleep: {
    enabled: true,
    intervalMinutes: 1440, // once per day
    activeStart: 22,
    activeEnd: 23,
    requirePing: false,
    pingIp: "",
  },
};

// ── In-memory state ─────────────────────────────────────────────

let config: HealthConfig | null = null;
let configPath: string | null = null;
let latestSteps: number | null = null;

export function updateSteps(steps: number) {
  latestSteps = steps;
}
export function getLatestSteps() {
  return latestSteps;
}

/**
 * Ring buffer of recently sent reminders (in-memory only, not persisted).
 * Kept small — only the last few so Arona has context when Sensei replies.
 * Max age: 2 hours (reminders older than that are irrelevant to conversation).
 */
const MAX_SENT_HISTORY = 8;
const SENT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const sentHistory: SentReminder[] = [];

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

// ── Sent Reminder History ──────────────────────────────────────

/**
 * Record that a health reminder was just sent.
 * Called by the health scheduler after successful delivery.
 */
export function recordSentReminder(type: string, text: string): void {
  sentHistory.push({ type, text, sentAt: Date.now() });
  // Trim to max size
  while (sentHistory.length > MAX_SENT_HISTORY) {
    sentHistory.shift();
  }
}

/**
 * Get recently sent reminders (within the last 2 hours).
 * Used by system prompt to give Arona context about what was sent.
 */
export function getRecentReminders(): SentReminder[] {
  const cutoff = Date.now() - SENT_MAX_AGE_MS;
  return sentHistory.filter((r) => r.sentAt >= cutoff);
}

// ── System Prompt Context ──────────────────────────────────────

/** Format relative time ago in a compact way. */
function formatTimeAgo(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hrs = Math.round(mins / 60);
  return `${hrs} giờ trước`;
}

/** Map windowKey/type back to a friendly label. */
function reminderLabel(type: string): string {
  switch (type) {
    case "water":
    case "health-water":
      return "Uống nước";
    case "eyes":
    case "health-eyes":
      return "Nghỉ mắt";
    case "movement":
    case "health-movement":
      return "Vận động";
    case "sleep":
    case "health-sleep":
      return "Đi ngủ";
    default:
      return type;
  }
}

/** Build a summary of health config for system prompt injection. */
export function buildHealthConfigSummary(): string {
  const cfg = getHealthConfig();
  const lines: string[] = ["[Health Reminder Settings]"];

  const describe = (name: string, c: HealthReminderConfig): string => {
    if (!c.enabled) return `- ${name}: OFF`;
    let desc = `- ${name}: every ${c.intervalMinutes}min (${c.activeStart}:00-${c.activeEnd}:00)`;
    if (c.requirePing && c.pingIp) {
      desc += ` (Pings ${c.pingIp} before firing)`;
    }
    return desc;
  };

  lines.push(describe("Water", cfg.water));
  lines.push(describe("Eye break", cfg.eyes));
  lines.push(describe("Movement", cfg.movement));
  lines.push(describe("Sleep", cfg.sleep));

  // Append recently sent reminders so Arona knows context
  const recent = getRecentReminders();
  if (recent.length > 0) {
    const now = Date.now();
    lines.push("");
    lines.push("[Recently Sent Health Reminders]");
    for (const r of recent) {
      const ago = formatTimeAgo(now - r.sentAt);
      const label = reminderLabel(r.type);
      // Truncate text to keep prompt lean
      const shortText = r.text.length > 80 ? r.text.slice(0, 77) + "..." : r.text;
      lines.push(`- [${label}] (${ago}) "${shortText}"`);
    }
    lines.push("");
    lines.push(
      "If Sensei mentions something related to a recent reminder (e.g. 'uống rồi', 'ok', 'lát nữa'), " +
        "acknowledge it naturally — Arona sent these reminders and should respond to feedback about them.",
    );
  }

  lines.push("");
  lines.push(
    "Sensei can adjust these by telling Arona, e.g. 'nhắc uống nước mỗi 1.5 tiếng' or 'turn off eye break reminders'.",
  );

  if (latestSteps !== null) {
    // Inject step count info into prompt so Arona knows Sensei's activity
    lines.push("");
    lines.push(`[Current HealthKit Data]`);
    lines.push(`Sensei has walked ${latestSteps} steps today.`);
    lines.push(
      `If Sensei has walked over 2000 steps recently, you can praise them in the Movement reminder, otherwise encourage them more.`,
    );
  }

  return lines.join("\n");
}

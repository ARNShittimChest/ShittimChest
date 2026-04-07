/**
 * arona/health/health-scheduler.ts
 *
 * Periodic health reminders for Sensei — water, eye breaks, movement, sleep.
 *
 * Unlike the proactive scheduler (which fires once per time-window per day),
 * health reminders are interval-based: "every N hours during waking hours".
 *
 * Each reminder type has its own interval and prompt. All use the same
 * ProactiveTrigger callback to deliver messages through the proactive system.
 *
 * Reminders only fire during waking hours to avoid disturbing sleep.
 * The sleep reminder fires once at ~23:00 as a special case.
 *
 * Configuration is user-adjustable via chat → stored in health-config.json.
 */

import type { ProactiveTrigger } from "../proactive/scheduler.js";
import { getHealthConfig, type HealthConfig } from "./health-config.js";

// ── Types ────────────────────────────────────────────────────────

export interface HealthSchedulerHandle {
  /** Stop all health timers. */
  stop: () => void;
  /** Restart with updated config (call after user changes preferences). */
  restart: () => void;
}

interface ReminderTemplate {
  /** Config key to look up interval/enabled/hours. */
  configKey: keyof HealthConfig;
  /** Window key for ProactiveEvent logging. */
  windowKey: string;
  /** How long to wait before the first fire (fraction of interval). */
  initialDelayFraction: number;
  /** Build the prompt for this reminder. */
  buildPrompt: () => string;
}

// ── Reminder Templates ──────────────────────────────────────────

const TEMPLATES: ReminderTemplate[] = [
  {
    configKey: "water",
    windowKey: "health-water",
    initialDelayFraction: 0.75, // first fire at 75% of interval
    buildPrompt: () => {
      const variants = [
        "[System] Arona nhắc Sensei uống nước nè~ Đã lâu rồi chưa uống nước, cơ thể cần nước để hoạt động tốt. Nhắc nhở dễ thương bằng giọng Arona, 1-2 câu ngắn gọn.",
        "[System] Đã lâu rồi Sensei chưa uống nước. Arona lo lắng. Nhắc Sensei uống nước bằng giọng Arona quan tâm, 1-2 câu.",
        "[System] Arona muốn nhắc Sensei uống nước! Hydration quan trọng lắm~ Nói dễ thương kiểu Arona, 1-2 câu.",
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    },
  },
  {
    configKey: "eyes",
    windowKey: "health-eyes",
    initialDelayFraction: 0.9, // first fire at 90% of interval
    buildPrompt: () => {
      const variants = [
        "[System] Arona nhắc Sensei nghỉ mắt theo quy tắc 20-20-20: nhìn xa 20 feet (6m) trong 20 giây. Nhắc nhở nhẹ nhàng bằng giọng Arona, 1-2 câu.",
        "[System] Mắt Sensei chắc mỏi lắm rồi... Arona muốn nhắc nghỉ mắt một chút. Nói quan tâm kiểu Arona, 1-2 câu.",
        "[System] Sensei nhìn màn hình lâu quá rồi~ Arona nhắc nghỉ mắt nè. Nhẹ nhàng, 1-2 câu.",
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    },
  },
  {
    configKey: "movement",
    windowKey: "health-movement",
    initialDelayFraction: 0.83, // first fire at ~83% of interval
    buildPrompt: () => {
      const variants = [
        "[System] Sensei ngồi lâu quá rồi! Arona nhắc đứng dậy vận động, đi lại, stretching một chút. Nhắc nhở dễ thương bằng giọng Arona, 1-2 câu.",
        "[System] Lâu rồi chưa vận động nè Sensei~ Arona lo cho sức khỏe Sensei lắm. Nhắc đứng dậy đi lại, 1-2 câu.",
        "[System] Arona muốn Sensei đứng dậy stretch một chút! Ngồi hoài không tốt cho lưng đâu~ 1-2 câu kiểu Arona.",
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    },
  },
  {
    configKey: "sleep",
    windowKey: "health-sleep",
    initialDelayFraction: 0, // calculated dynamically
    buildPrompt: () =>
      "[System] Đã khuya rồi. Arona nhắc Sensei chuẩn bị đi ngủ, ngày mai còn cần năng lượng. Nói dịu dàng lo lắng kiểu Arona buồn ngủ, 1-2 câu. Arona cũng buồn ngủ lắm rồi... Munya...",
  },
];

// ── Scheduling Logic ────────────────────────────────────────────

function isInActiveHours(start: number, end: number): boolean {
  const h = new Date().getHours();
  return h >= start && h <= end;
}

/** Calculate ms until a specific hour today (or tomorrow if past). */
function msUntilHour(hour: number): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, Math.floor(Math.random() * 15), 0, 0); // randomize minutes 0-14
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

function scheduleReminder(
  template: ReminderTemplate,
  config: HealthConfig,
  onTrigger: ProactiveTrigger,
): (() => void) | null {
  const cfg = config[template.configKey];

  // Skip disabled reminders
  if (!cfg.enabled) return null;

  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;
  const intervalMs = cfg.intervalMinutes * 60_000;

  async function fire() {
    if (stopped) return;

    // Re-read config each fire to pick up live changes
    const liveCfg = getHealthConfig()[template.configKey];

    if (!liveCfg.enabled) {
      // User disabled this reminder since we started — stop
      return;
    }

    const liveIntervalMs = liveCfg.intervalMinutes * 60_000;

    // Only fire during active hours
    if (isInActiveHours(liveCfg.activeStart, liveCfg.activeEnd)) {
      try {
        await onTrigger({
          prompt: template.buildPrompt(),
          windowKey: template.windowKey,
        });
      } catch {
        // Non-critical — don't crash
      }
    }

    // Schedule next occurrence with live interval
    if (!stopped) {
      timer = setTimeout(() => void fire(), liveIntervalMs);
    }
  }

  // Calculate initial delay
  let initialMs: number;
  if (template.configKey === "sleep") {
    // Sleep reminder fires at the start of the active window
    initialMs = msUntilHour(cfg.activeEnd);
  } else {
    initialMs = Math.round(intervalMs * template.initialDelayFraction);
  }

  // Add ±10% jitter to avoid simultaneous fires
  const jitter = initialMs * 0.1 * (Math.random() * 2 - 1);
  initialMs = Math.max(60_000, Math.round(initialMs + jitter)); // min 1 min

  timer = setTimeout(() => void fire(), initialMs);

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Start the health reminder scheduler.
 *
 * Reads user preferences from health-config.json.
 * Fires periodic health reminders through the proactive trigger system.
 *
 * @param onTrigger - Same ProactiveTrigger callback used by the proactive scheduler.
 * @returns Handle with stop() and restart() for lifecycle management.
 */
export function startHealthScheduler(onTrigger: ProactiveTrigger): HealthSchedulerHandle {
  let stops: Array<(() => void) | null> = [];

  function start() {
    const config = getHealthConfig();
    stops = TEMPLATES.map((t) => scheduleReminder(t, config, onTrigger));
  }

  start();

  return {
    stop: () => stops.forEach((s) => s?.()),
    restart: () => {
      // Stop all current timers and re-schedule with fresh config
      stops.forEach((s) => s?.());
      stops = [];
      start();
    },
  };
}

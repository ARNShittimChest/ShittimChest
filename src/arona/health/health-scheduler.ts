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
 * Reminders only fire during waking hours (6:00–23:00) to avoid disturbing sleep.
 * The sleep reminder fires once at ~23:00 as a special case.
 */

import type { ProactiveTrigger } from "../proactive/scheduler.js";

// ── Types ────────────────────────────────────────────────────────

export interface HealthSchedulerHandle {
  /** Stop all health timers. */
  stop: () => void;
}

interface HealthReminder {
  /** Unique key for logging. */
  key: string;
  /** Interval in milliseconds. */
  intervalMs: number;
  /** Initial delay before first fire (ms). */
  initialDelayMs: number;
  /** Only fire during these hours (inclusive). */
  activeHours: { start: number; end: number };
  /** Build the prompt for this reminder. */
  buildPrompt: () => string;
}

// ── Reminder Definitions ────────────────────────────────────────

const REMINDERS: HealthReminder[] = [
  {
    key: "health-water",
    intervalMs: 2 * 60 * 60_000, // every 2 hours
    initialDelayMs: 90 * 60_000, // first after 1.5h (not immediately)
    activeHours: { start: 7, end: 22 },
    buildPrompt: () => {
      const variants = [
        "[System] Arona nhắc Sensei uống nước nè~ Đã lâu rồi chưa uống nước, cơ thể cần nước để hoạt động tốt. Nhắc nhở dễ thương bằng giọng Arona, 1-2 câu ngắn gọn.",
        "[System] Đã 2 tiếng rồi Sensei chưa uống nước. Arona lo lắng. Nhắc Sensei uống nước bằng giọng Arona quan tâm, 1-2 câu.",
        "[System] Arona muốn nhắc Sensei uống nước! Hydration quan trọng lắm~ Nói dễ thương kiểu Arona, 1-2 câu.",
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    },
  },
  {
    key: "health-eyes",
    intervalMs: 45 * 60_000, // every 45 minutes
    initialDelayMs: 40 * 60_000, // first after 40min
    activeHours: { start: 7, end: 23 },
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
    key: "health-movement",
    intervalMs: 3 * 60 * 60_000, // every 3 hours
    initialDelayMs: 2.5 * 60 * 60_000, // first after 2.5h
    activeHours: { start: 7, end: 22 },
    buildPrompt: () => {
      const variants = [
        "[System] Sensei ngồi lâu quá rồi! Arona nhắc đứng dậy vận động, đi lại, stretching một chút. Nhắc nhở dễ thương bằng giọng Arona, 1-2 câu.",
        "[System] 3 tiếng rồi chưa vận động nè Sensei~ Arona lo cho sức khỏe Sensei lắm. Nhắc đứng dậy đi lại, 1-2 câu.",
        "[System] Arona muốn Sensei đứng dậy stretch một chút! Ngồi hoài không tốt cho lưng đâu~ 1-2 câu kiểu Arona.",
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    },
  },
  {
    key: "health-sleep",
    intervalMs: 24 * 60 * 60_000, // once per day
    initialDelayMs: 0, // calculated dynamically below
    activeHours: { start: 22, end: 23 }, // narrow window — fires once at ~23:00
    buildPrompt: () =>
      "[System] Đã gần 23h rồi. Arona nhắc Sensei chuẩn bị đi ngủ, ngày mai còn cần năng lượng. Nói dịu dàng lo lắng kiểu Arona buồn ngủ, 1-2 câu. Arona cũng buồn ngủ lắm rồi... Munya...",
  },
];

// ── Scheduling Logic ────────────────────────────────────────────

function isInActiveHours(hours: { start: number; end: number }): boolean {
  const h = new Date().getHours();
  return h >= hours.start && h <= hours.end;
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

function scheduleReminder(reminder: HealthReminder, onTrigger: ProactiveTrigger): () => void {
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;

  async function fire() {
    if (stopped) return;

    // Only fire during active hours
    if (isInActiveHours(reminder.activeHours)) {
      try {
        await onTrigger({
          prompt: reminder.buildPrompt(),
          windowKey: reminder.key,
        });
      } catch {
        // Non-critical — don't crash
      }
    }

    // Schedule next occurrence
    if (!stopped) {
      timer = setTimeout(() => void fire(), reminder.intervalMs);
    }
  }

  // Calculate initial delay
  let initialMs = reminder.initialDelayMs;

  // Special case: sleep reminder fires at ~23:00
  if (reminder.key === "health-sleep") {
    initialMs = msUntilHour(23);
  }

  // Add some jitter (±10%) to avoid simultaneous fires
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
 * Fires periodic health reminders (water, eyes, movement, sleep)
 * through the proactive trigger system.
 *
 * @param onTrigger - Same ProactiveTrigger callback used by the proactive scheduler.
 * @returns Handle with stop() to gracefully shut down all timers.
 */
export function startHealthScheduler(onTrigger: ProactiveTrigger): HealthSchedulerHandle {
  const stops = REMINDERS.map((r) => scheduleReminder(r, onTrigger));

  return {
    stop: () => stops.forEach((s) => s()),
  };
}

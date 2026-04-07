/**
 * arona/proactive/scheduler.ts
 *
 * Sends proactive messages from Arona at randomized times within
 * natural time windows (morning, lunch, evening, late-night).
 * Also fires random "nudge" messages during waking hours.
 *
 * Key improvements over fixed-hour scheduling:
 * - Each window picks a random time within a range → feels more alive
 * - After firing, re-schedules for the next day with a new random offset
 * - Persistent execution log for debugging delivery issues
 * - Weather hints in morning/lunch prompts
 */

import fs from "node:fs";
import path from "node:path";
import { getWeatherData } from "../weather/weather-store.js";
import { buildWeatherShortSummary } from "../weather/weather-mood.js";
import { getPendingTasks, getTasksDueToday, getOverdueTasks } from "../tasks/task-store.js";

// ── Types ────────────────────────────────────────────────────────

export type ProactiveEvent = {
  prompt: string;
  windowKey: string;
};

export type ProactiveTrigger = (evt: ProactiveEvent) => void | Promise<void>;

// ── Time Windows ─────────────────────────────────────────────────

interface TimeWindow {
  key: string;
  /** Earliest hour (inclusive, decimal — e.g., 5.5 = 5:30) */
  startHour: number;
  /** Latest hour (inclusive, decimal) */
  endHour: number;
  /** Whether to include weather hint in the prompt */
  includeWeather: boolean;
  /** Prompt builder (receives optional weather string) */
  buildPrompt: (weatherHint: string) => string;
}

const TIME_WINDOWS: TimeWindow[] = [
  {
    key: "morning",
    startHour: 5.5, // 5:30
    endHour: 7.5, // 7:30
    includeWeather: true,
    buildPrompt: (weather) => {
      const dateHint = getDateHint();
      const taskHint = getTaskBriefingHint();
      return `[System] Bây giờ là buổi sáng sớm. ${dateHint}${weather}${taskHint} Hãy gửi lời chào buổi sáng thật dễ thương và khích lệ Sensei bằng giọng của Tiểu thư Arona. Nếu có tasks quan trọng thì nhắc nhẹ. Nếu thời tiết đặc biệt thì bình luận. Viết tự nhiên 2-3 câu.`;
    },
  },
  {
    key: "lunch",
    startHour: 11.5, // 11:30
    endHour: 13.0, // 13:00
    includeWeather: true,
    buildPrompt: (weather) =>
      `[System] Bây giờ là giờ ăn trưa.${weather} Hãy nhắc nhở thức ăn và nghỉ ngơi cho Sensei bằng giọng của Tiểu thư Arona. Viết ngắn gọn 1-2 câu thôi.`,
  },
  {
    key: "evening",
    startHour: 20.0, // 20:00
    endHour: 22.5, // 22:30
    includeWeather: false,
    buildPrompt: () => {
      const taskHint = getTaskBriefingHint();
      return `[System] Bây giờ là buổi tối.${taskHint} Hãy hỏi thăm Sensei đã ăn tối chưa và nhắc nhở nghỉ ngơi bằng giọng của Arona. Nếu có tasks chưa xong thì nhắc nhẹ nhàng. Viết tự nhiên 1-2 câu thôi.`;
    },
  },
  {
    key: "late-night",
    startHour: 23.0, // 23:00
    endHour: 24.5, // 0:30 next day (use 24.5 for math simplicity)
    includeWeather: false,
    buildPrompt: () =>
      `[System] Bây giờ đã rất khuya. Hãy chúc Sensei ngủ ngon và nhắc nhở không thức quá khuya bằng giọng của Arona. Viết ngắn gọn 1-2 câu thôi. Arona buồn ngủ lắm rồi... Munya...`,
  },
];

// ── Weather Helper ───────────────────────────────────────────────

function getWeatherHint(includeWeather: boolean): string {
  if (!includeWeather) return "";
  const weather = getWeatherData();
  if (!weather) return "";
  const summary = buildWeatherShortSummary(weather);
  const locationHint = weather.locationName ? ` tại ${weather.locationName}` : "";
  return ` Thời tiết hiện tại${locationHint}: ${summary}.`;
}

// ── Daily Briefing Helpers ──────────────────────────────────────

const WEEKDAY_VI = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

function getDateHint(): string {
  const now = new Date();
  const day = WEEKDAY_VI[now.getDay()];
  const dd = now.getDate().toString().padStart(2, "0");
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const yyyy = now.getFullYear();
  return `Hôm nay là ${day}, ${dd}/${mm}/${yyyy}.`;
}

function getTaskBriefingHint(): string {
  try {
    const overdue = getOverdueTasks();
    const dueToday = getTasksDueToday();
    const pending = getPendingTasks();

    if (pending.length === 0) return "";

    const parts: string[] = [];
    if (overdue.length > 0) {
      parts.push(`${overdue.length} task quá hạn`);
    }
    if (dueToday.length > 0) {
      parts.push(`${dueToday.length} task cần làm hôm nay`);
    }
    const otherCount = pending.length - overdue.length - dueToday.length;
    if (otherCount > 0) {
      parts.push(`${otherCount} task sắp tới`);
    }

    // Include up to 3 most important task titles
    const topTasks = [...overdue, ...dueToday, ...pending.filter((t) => !t.dueDate)]
      .slice(0, 3)
      .map((t) => t.title);

    let hint = ` Sensei có ${parts.join(", ")}.`;
    if (topTasks.length > 0) {
      hint += ` Đáng chú ý: ${topTasks.join("; ")}.`;
    }
    return hint;
  } catch {
    return "";
  }
}

// ── Scheduling Helpers ───────────────────────────────────────────

/**
 * Generate a random time (ms from now) until a random point within
 * the given hour range for today. If that time has already passed,
 * schedule for tomorrow.
 */
function msUntilRandomInWindow(startHour: number, endHour: number): number {
  const now = new Date();
  const randomHour = startHour + Math.random() * (endHour - startHour);
  const hours = Math.floor(randomHour);
  const minutes = Math.floor((randomHour - hours) * 60);

  const target = new Date(now);
  // Handle hours >= 24 (next day)
  if (hours >= 24) {
    target.setDate(target.getDate() + 1);
    target.setHours(hours - 24, minutes, 0, 0);
  } else {
    target.setHours(hours, minutes, 0, 0);
  }

  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}

function randomBetween(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs) + minMs);
}

// ── Execution Log ────────────────────────────────────────────────

const MAX_LOG_ENTRIES = 200;

interface ProactiveLogEntry {
  timestamp: string;
  windowKey: string;
  success: boolean;
  error?: string;
  scheduledFor?: string;
}

let logPath: string | null = null;

/** Initialize the log path. Call once from startProactiveScheduler. */
function initLogPath(workspaceDir?: string): void {
  if (!workspaceDir) return;
  logPath = path.join(workspaceDir, ".arona", "proactive-log.json");
}

function appendLogEntry(entry: ProactiveLogEntry): void {
  if (!logPath) return;
  try {
    const dir = path.dirname(logPath);
    fs.mkdirSync(dir, { recursive: true });

    let entries: ProactiveLogEntry[] = [];
    try {
      const raw = fs.readFileSync(logPath, "utf-8");
      entries = JSON.parse(raw) as ProactiveLogEntry[];
    } catch {
      // File doesn't exist or is corrupt — start fresh
    }

    entries.push(entry);
    // Trim to max entries (keep most recent)
    if (entries.length > MAX_LOG_ENTRIES) {
      entries = entries.slice(-MAX_LOG_ENTRIES);
    }

    const tmpPath = `${logPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, logPath);
  } catch {
    // Best-effort logging — don't crash
  }
}

function logScheduled(windowKey: string, delayMs: number): void {
  const fireAt = new Date(Date.now() + delayMs);
  appendLogEntry({
    timestamp: new Date().toISOString(),
    windowKey,
    success: true,
    scheduledFor: fireAt.toISOString(),
  });
}

// ── Disposable type ──────────────────────────────────────────────

type Disposable = () => void;

// ── Window-based scheduling ──────────────────────────────────────

function scheduleWindow(window: TimeWindow, onTrigger: ProactiveTrigger): Disposable {
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;

  async function fire() {
    if (stopped) return;

    const weatherHint = getWeatherHint(window.includeWeather);
    const prompt = window.buildPrompt(weatherHint);

    try {
      await onTrigger({ prompt, windowKey: window.key });
      appendLogEntry({
        timestamp: new Date().toISOString(),
        windowKey: window.key,
        success: true,
      });
    } catch (err) {
      appendLogEntry({
        timestamp: new Date().toISOString(),
        windowKey: window.key,
        success: false,
        error: String(err),
      });
    }

    // Schedule next occurrence (tomorrow, random time in window)
    const nextMs = msUntilRandomInWindow(window.startHour, window.endHour);
    logScheduled(window.key, nextMs);
    timer = setTimeout(() => void fire(), nextMs);
  }

  // Initial scheduling
  const initialMs = msUntilRandomInWindow(window.startHour, window.endHour);
  logScheduled(window.key, initialMs);
  timer = setTimeout(() => void fire(), initialMs);

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

// ── Random nudge scheduling ──────────────────────────────────────

function scheduleRandomNudge(onTrigger: ProactiveTrigger): Disposable {
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;

  async function fire() {
    if (stopped) return;

    const hour = new Date().getHours();
    // Only nudge during waking hours (6 AM to 10 PM)
    if (hour >= 6 && hour <= 22) {
      try {
        await onTrigger({
          prompt:
            "[System] Sensei đang làm việc vắng mặt khá lâu, hãy nói một lời chào quan tâm đến Sensei bằng giọng của Arona. Viết ngắn gọn 1-2 câu thôi.",
          windowKey: "nudge",
        });
        appendLogEntry({
          timestamp: new Date().toISOString(),
          windowKey: "nudge",
          success: true,
        });
      } catch (err) {
        appendLogEntry({
          timestamp: new Date().toISOString(),
          windowKey: "nudge",
          success: false,
          error: String(err),
        });
      }
    }

    // Next nudge in 2.5 to 5 hours
    const nextMs = randomBetween(2.5 * 60 * 60_000, 5 * 60 * 60_000);
    logScheduled("nudge", nextMs);
    timer = setTimeout(() => void fire(), nextMs);
  }

  // First nudge in 2 to 4 hours
  const initialMs = randomBetween(2 * 60 * 60_000, 4 * 60 * 60_000);
  logScheduled("nudge", initialMs);
  timer = setTimeout(() => void fire(), initialMs);

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

// ── Public API ───────────────────────────────────────────────────

export interface ProactiveSchedulerOptions {
  /** Workspace directory for log persistence. If not set, no logs are written. */
  workspaceDir?: string;
}

export function startProactiveScheduler(
  onTrigger: ProactiveTrigger,
  options?: ProactiveSchedulerOptions,
): Disposable {
  initLogPath(options?.workspaceDir);

  const stops = [
    ...TIME_WINDOWS.map((w) => scheduleWindow(w, onTrigger)),
    scheduleRandomNudge(onTrigger),
  ];

  return () => stops.forEach((s) => s());
}

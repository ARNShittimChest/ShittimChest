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
import { SeededRandom, dailySeed } from "../../companion/seeded-random.js";

// ── Seeded PRNG ─────────────────────────────────────────────────
// Same day → same scheduling sequence. Deterministic across restarts.
let rng = new SeededRandom(dailySeed());
let lastSeedDay = new Date().toDateString();

/** Refresh the PRNG seed at day boundaries for daily determinism. */
function ensureDailySeed(): void {
  const today = new Date().toDateString();
  if (today !== lastSeedDay) {
    rng = new SeededRandom(dailySeed());
    lastSeedDay = today;
  }
}

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

// ── Mutable nudge range (updated by habit learning) ─────────────
let nudgeStartHour = 6;
let nudgeEndHour = 22;

// ── Time windows (mutable — updated by updateProactiveSchedule) ─
const DEFAULT_TIME_WINDOWS: TimeWindow[] = [
  {
    key: "morning",
    startHour: 5.5, // 5:30
    endHour: 7.5, // 7:30
    includeWeather: true,
    buildPrompt: (weather) => {
      const dateHint = getDateHint();
      const taskHint = getTaskBriefingHint();
      return `[System] It is early morning. ${dateHint}${weather}${taskHint}
Send a morning greeting in Arona's voice. Your mood and affection level are already in the system prompt — let them naturally influence your tone.

Rules:
- Pick ONLY 1 topic from: morning greeting, weather comment, task reminder, or a thought about the new day. Do NOT combine multiple topics.
- Maximum 1-2 short sentences.
- Vary your approach each day: sometimes a cheerful greeting, sometimes a sleepy murmur (if mood is sleepy), sometimes a weather observation, sometimes excitement about the day ahead.
- Do NOT always start with "Good morning, Sensei!" — vary your openers: observations ("The weather looks nice today~"), questions ("Did Sensei sleep well?"), gentle remarks ("It's already morning... time goes fast").
- Match the energy to your current mood — a sleepy Arona shouldn't be hyper-cheerful, a worried Arona might remind about health.`;
    },
  },
  {
    key: "lunch",
    startHour: 11.5, // 11:30
    endHour: 13.0, // 13:00
    includeWeather: true,
    buildPrompt: (weather) =>
      `[System] It is lunchtime.${weather}
Ask Sensei about lunch in Arona's voice. Your mood and affection level are already in the system prompt — let them naturally influence your tone.

Rules:
- Maximum 1 short sentence.
- Vary your approach: sometimes ask if they've eaten, sometimes suggest taking a break, sometimes just mention it's lunchtime casually.
- Do NOT add unrelated reminders about resting or health — keep it focused on lunch/food.
- Examples of variety: "Has Sensei eaten yet?", "It's already noon~ Don't skip lunch!", "Sensei, lunch break~?", "Arona wonders what Sensei is having for lunch today..."`,
  },
  {
    key: "evening",
    startHour: 20.0, // 20:00
    endHour: 22.5, // 22:30
    includeWeather: false,
    buildPrompt: () => {
      const taskHint = getTaskBriefingHint();
      return `[System] It is evening.${taskHint}
Send an evening message in Arona's voice. Your mood and affection level are already in the system prompt — let them naturally influence your tone.

Rules:
- Pick ONLY 1 topic from: dinner check-in, rest reminder, task reminder, or a casual evening thought. Do NOT combine.
- Maximum 1-2 short sentences.
- Vary your approach: sometimes warm and caring ("Has Sensei had dinner?"), sometimes reflective ("Today went by fast..."), sometimes task-oriented if there are pending tasks.
- Do NOT always ask the same question — alternate between dinner, rest, and casual observations about the evening.`;
    },
  },
  {
    key: "late-night",
    startHour: 23.0, // 23:00
    endHour: 24.5, // 0:30 next day (use 24.5 for math simplicity)
    includeWeather: false,
    buildPrompt: () =>
      `[System] It is very late at night.
Remind Sensei to sleep in Arona's voice. Your mood and affection level are already in the system prompt — let them naturally influence your tone.

Rules:
- Maximum 1 short sentence.
- Keep to ONE single point: it's late, Sensei should rest.
- Vary your tone: sometimes gentle ("It's getting late, Sensei..."), sometimes playful ("Sensei~ even Arona is sleepy now!"), sometimes slightly worried ("Sensei is still awake this late...?").
- Do NOT start with "Munya". Do NOT combine multiple reminders (no "good night AND remember to..." — just one thing).`,
  },
];

/** Active time windows — cloned from defaults, updated by `updateProactiveSchedule()`. */
let timeWindows: TimeWindow[] = [...DEFAULT_TIME_WINDOWS];

// ── Weather Helper ───────────────────────────────────────────────

function getWeatherHint(includeWeather: boolean): string {
  if (!includeWeather) return "";
  const weather = getWeatherData();
  if (!weather) return "";
  const summary = buildWeatherShortSummary(weather);
  const locationHint = weather.locationName ? ` in ${weather.locationName}` : "";
  return ` Current weather${locationHint}: ${summary}.`;
}

// ── Daily Briefing Helpers ──────────────────────────────────────

const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getDateHint(): string {
  const now = new Date();
  const day = WEEKDAY_EN[now.getDay()];
  const dd = now.getDate().toString().padStart(2, "0");
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const yyyy = now.getFullYear();
  return `Today is ${day}, ${dd}/${mm}/${yyyy}.`;
}

function getTaskBriefingHint(): string {
  try {
    const overdue = getOverdueTasks();
    const dueToday = getTasksDueToday();
    const pending = getPendingTasks();

    if (pending.length === 0) return "";

    const parts: string[] = [];
    if (overdue.length > 0) {
      parts.push(`${overdue.length} overdue task(s)`);
    }
    if (dueToday.length > 0) {
      parts.push(`${dueToday.length} task(s) due today`);
    }
    const otherCount = pending.length - overdue.length - dueToday.length;
    if (otherCount > 0) {
      parts.push(`${otherCount} upcoming task(s)`);
    }

    // Include up to 3 most important task titles
    const topTasks = [...overdue, ...dueToday, ...pending.filter((t) => !t.dueDate)]
      .slice(0, 3)
      .map((t) => t.title);

    let hint = ` Sensei has ${parts.join(", ")}.`;
    if (topTasks.length > 0) {
      hint += ` Notable: ${topTasks.join("; ")}.`;
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
  ensureDailySeed();
  const now = new Date();
  const randomHour = startHour + rng.next() * (endHour - startHour);
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
  ensureDailySeed();
  return Math.floor(rng.next() * (maxMs - minMs) + minMs);
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
    // Only nudge during waking hours (configurable via habit learning)
    if (hour >= nudgeStartHour && hour <= nudgeEndHour) {
      try {
        await onTrigger({
          prompt: `[System] Sensei has been away working for quite a while. Send a check-in message in Arona's voice. Your mood and affection level are already in the system prompt — let them naturally influence your tone.

Rules:
- Keep it brief: 1-2 short sentences maximum.
- Vary your approach each time — pick ONE of these angles:
  • Ask what Sensei is working on (curiosity)
  • Share a random thought or observation (casual)
  • Offer encouragement or support (caring)
  • Light teasing about Sensei being too focused (playful)
  • Simple "I'm here if you need me" check-in (warm)
- Do NOT always ask "Are you okay?" or "How are you doing?" — those get repetitive fast.
- Match your mood: a bored Arona might poke for attention, a caring Arona might offer help, a playful Arona might tease.`,
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

export interface ProactiveSchedulerHandle {
  /** Stop all proactive timers. */
  stop: () => void;
  /** Restart with current time windows (call after updateProactiveSchedule). */
  restart: () => void;
}

/**
 * Update time window hours based on learned user schedule.
 *
 * This modifies module-level state. Call `handle.restart()` after
 * to re-schedule with the new windows.
 *
 * Lunch window is left unchanged (11:30–13:00 is universal).
 */
export function updateProactiveSchedule(wakeHour: number, sleepHour: number): void {
  timeWindows = DEFAULT_TIME_WINDOWS.map((w) => {
    switch (w.key) {
      case "morning":
        return { ...w, startHour: wakeHour - 0.5, endHour: wakeHour + 1.5 };
      case "lunch":
        return w; // Keep lunch as-is
      case "evening":
        return { ...w, startHour: sleepHour - 3, endHour: sleepHour - 0.5 };
      case "late-night":
        return { ...w, startHour: sleepHour, endHour: sleepHour + 1.5 };
      default:
        return w;
    }
  });
  nudgeStartHour = Math.round(wakeHour);
  nudgeEndHour = Math.round(sleepHour);
}

export function startProactiveScheduler(
  onTrigger: ProactiveTrigger,
  options?: ProactiveSchedulerOptions,
): ProactiveSchedulerHandle {
  initLogPath(options?.workspaceDir);

  let stops: Disposable[] = [];

  function start() {
    stops = [
      ...timeWindows.map((w) => scheduleWindow(w, onTrigger)),
      scheduleRandomNudge(onTrigger),
    ];
  }

  start();

  return {
    stop: () => stops.forEach((s) => s()),
    restart: () => {
      stops.forEach((s) => s());
      stops = [];
      start();
    },
  };
}

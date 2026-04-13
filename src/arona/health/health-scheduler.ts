/**
 * arona/health/health-scheduler.ts
 *
 * Periodic health reminders for Sensei — water, eye breaks, movement, sleep.
 *
 * Unlike the proactive scheduler (which fires once per time-window per day),
 * health reminders are interval-based: "every N hours during waking hours".
 *
 * Each reminder calls the LLM to generate a unique Arona-voice notification,
 * then delivers it directly to all linked chat platforms and the iOS app
 * (bypassing the full chat.send pipeline for speed and simplicity).
 *
 * Falls back to pre-written templates if the LLM call fails.
 *
 * Reminders only fire during waking hours to avoid disturbing sleep.
 * The sleep reminder fires once at ~23:00 as a special case.
 *
 * Configuration is user-adjustable via chat → stored in health-config.json.
 */

import { createSubsystemLogger } from "../../logging/subsystem.js";
import { completeSimple } from "@mariozechner/pi-ai";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import { getApiKeyForModel } from "../../agents/model-auth.js";
import { resolveModel } from "../../agents/pi-embedded-runner/model.js";
import type { ShittimChestConfig } from "../../config/config.js";
import {
  getHealthConfig,
  type HealthConfig,
  getLatestSteps,
  getHealthKitData,
} from "./health-config.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { SeededRandom, dailySeed } from "../../companion/seeded-random.js";

const execAsync = promisify(exec);

const log = createSubsystemLogger("health-scheduler");

// ── Seeded PRNG ─────────────────────────────────────────────────
// Same day → same scheduling sequence. Deterministic across restarts.
let rng = new SeededRandom(dailySeed());
let lastSeedDay = new Date().toDateString();

function ensureDailySeed(): void {
  const today = new Date().toDateString();
  if (today !== lastSeedDay) {
    rng = new SeededRandom(dailySeed());
    lastSeedDay = today;
  }
}

// ── Types ────────────────────────────────────────────────────────

/** Event emitted when a health reminder fires. */
export interface HealthReminderEvent {
  /** Key for logging (e.g., "health-water"). */
  windowKey: string;
  /** Notification text to send (LLM-generated or fallback). */
  notificationText: string;
  /** Short title for push notifications. */
  title: string;
}

/** Callback for health reminder delivery. */
export type HealthTrigger = (event: HealthReminderEvent) => void | Promise<void>;

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
  /** Title for push notification. */
  title: string;
  /** Prompt sent to LLM to generate a unique Arona-voice notification. */
  buildLlmPrompt: () => string;
  /** Fallback text if LLM call fails. */
  fallbackTexts: string[];
}

// ── Reminder Templates ──────────────────────────────────────────

const TEMPLATES: ReminderTemplate[] = [
  {
    configKey: "water",
    windowKey: "health-water",
    initialDelayFraction: 0.75,
    title: "💧 Water Reminder",
    buildLlmPrompt: () =>
      "Arona reminds Sensei to drink water. It's been a while since Sensei last drank water, the body needs to hydrate. Write 1-2 short sentences in Arona's cute, caring voice. May use emoji. ONLY reply with the message content, no extra explanation.",
    fallbackTexts: [
      "Sensei~! Time to drink some water~ It's been a while, your body needs to stay hydrated! 💧",
      "Munya~! Sensei, drink some water! Arona is worried... Don't forget to take care of yourself~ 💦",
      "Sensei! It's time for water~ Hydration is super important! Arona is reminding you ☺️💧",
      "Ding dong~! Arona is reminding Sensei to drink water! A glass of water will help Sensei stay sharp~ 🥤",
    ],
  },
  {
    configKey: "eyes",
    windowKey: "health-eyes",
    initialDelayFraction: 0.9,
    title: "👀 Eye Break",
    buildLlmPrompt: () =>
      "Arona reminds Sensei to rest their eyes. Sensei has been looking at the screen for a while, should follow the 20-20-20 rule (look at something 20 feet away for 20 seconds). Write 1-2 short sentences in Arona's gentle, caring voice. May use emoji. ONLY reply with the message content, no extra explanation.",
    fallbackTexts: [
      "Sensei~ Look at something 20 feet (6m) away for 20 seconds! Your eyes need a break~ 👀✨",
      "Munya... Sensei has been staring at the screen for too long! Take a little eye break~ Just look away for 20 seconds! 👁️",
      "Sensei~! Arona's eye break reminder! The 20-20-20 rule: every 20 minutes, look 20 feet away, for 20 seconds~ 👀💫",
      "Eye break time, Sensei! Look out the window or at something far away~ Sensei's eyes are important! ✨",
    ],
  },
  {
    configKey: "movement",
    windowKey: "health-movement",
    initialDelayFraction: 0.83,
    title: "🏃 Movement Reminder",
    buildLlmPrompt: () => {
      const hk = getHealthKitData();
      const stepInfo = hk.steps !== null ? ` Sensei has walked ${hk.steps} steps today.` : "";
      const energyInfo = hk.activeEnergyKcal
        ? ` Burned ${hk.activeEnergyKcal.toFixed(0)} kcal today.`
        : "";
      const hrInfo = hk.heartRate ? ` Current heart rate: ${hk.heartRate} BPM.` : "";
      return `Arona reminds Sensei to get up and move. Sensei has been sitting for too long, needs stretching and walking around.${stepInfo}${energyInfo}${hrInfo} Write 1-2 short sentences in Arona's cute voice, worried about Sensei's health. If steps > 2000, praise Sensei a little; if not enough, gently remind to walk more. May use emoji. ONLY reply with the message content, no extra explanation.`;
    },
    fallbackTexts: [
      "Sensei! Get up and move around a bit~ Sitting for too long isn't good for your back! Time to stretch~ 🏃‍♂️",
      "Munya~! Sensei has been sitting too long! Get up, walk around, do some stretching! Arona worries about Sensei's health~ 💪",
      "Movement break, Sensei! Stand up, walk around, twist your body a bit~ Your body will thank you! 🧘",
      "Sensei~! Arona's movement reminder! Stand up, stretch your back, roll your neck, take a few steps~ 🏋️",
    ],
  },
  {
    configKey: "sleep",
    windowKey: "health-sleep",
    initialDelayFraction: 0, // calculated dynamically
    title: "😴 Bedtime Reminder",
    buildLlmPrompt: () => {
      const hk = getHealthKitData();
      const sleepInfo = hk.sleepHours
        ? ` Last night Sensei slept ${hk.sleepHours.toFixed(1)} hours (${hk.sleepQuality ?? "unknown"}).`
        : "";
      const stepsInfo = hk.steps !== null ? ` Sensei walked ${hk.steps} steps today.` : "";
      return `It's late. Arona reminds Sensei to get ready for bed, tomorrow still needs energy.${sleepInfo}${stepsInfo} If last night's sleep was short, gently remind to sleep earlier tonight. Write 1-2 gentle, worried, sleepy sentences in Arona's voice. Arona is also sleepy. May use emoji. ONLY reply with the message content, no extra explanation.`;
    },
    fallbackTexts: [
      "Sensei... it's getting really late... Time to get ready for bed, you need energy for tomorrow~ Arona is so sleepy too... Munya... 🌙💤",
    ],
  },
];

// ── LLM Notification Generator ─────────────────────────────────

/**
 * Call the LLM to generate a unique Arona-voice notification.
 * Falls back to a random pre-written template if the LLM call fails.
 */
async function generateNotificationText(
  template: ReminderTemplate,
  cfg: ShittimChestConfig,
  agentId: string,
): Promise<string> {
  // Try LLM generation first
  try {
    const modelRef = resolveDefaultModelForAgent({ cfg, agentId });
    if (!modelRef) throw new Error("No model configured");

    const resolved = resolveModel(modelRef.provider, modelRef.model, undefined, cfg);
    if (!resolved.model) throw new Error(resolved.error ?? "Unknown model");

    const auth = await getApiKeyForModel({ model: resolved.model, cfg });
    if (!auth.apiKey) throw new Error("No API key");

    const response = await completeSimple(
      resolved.model,
      {
        messages: [
          {
            role: "user",
            content: template.buildLlmPrompt(),
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        temperature: 0.9, // High temperature for variety
        maxTokens: 500, // Short notification, but enough to not cut off sentences (e.g., Vietnamese needs more tokens)
      },
    );

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text.trim())
      .join("\n")
      .trim();

    if (text && text.length > 5) {
      log.debug(`[${template.windowKey}] LLM generated: ${text.slice(0, 80)}...`);
      return text;
    }
  } catch (err) {
    log.debug(`[${template.windowKey}] LLM generation failed, using fallback: ${String(err)}`);
  }

  // Fallback: deterministic pre-written template selection
  ensureDailySeed();
  return rng.pick(template.fallbackTexts);
}

// ── Scheduling Logic ────────────────────────────────────────────

function isInActiveHours(start: number, end: number): boolean {
  const h = new Date().getHours();
  return h >= start && h <= end;
}

/** Calculate ms until a specific hour today (or tomorrow if past). */
function msUntilHour(hour: number): number {
  const now = new Date();
  const target = new Date(now);
  ensureDailySeed();
  target.setHours(hour, rng.nextInt(0, 14), 0, 0); // deterministic minutes 0-14
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

function scheduleReminder(
  template: ReminderTemplate,
  config: HealthConfig,
  onTrigger: HealthTrigger,
  llmOpts: { cfg: ShittimChestConfig; agentId: string },
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
    let nextIntervalMs = liveIntervalMs;

    // Only fire during active hours
    if (isInActiveHours(liveCfg.activeStart, liveCfg.activeEnd)) {
      // Smart skip: auto-adjust based on HealthKit data
      const hk = getHealthKitData();

      // Skip movement reminder if Sensei just finished a workout (< 1 hour ago)
      if (template.configKey === "movement" && hk.lastWorkoutEndISO) {
        const workoutEndAge = Date.now() - new Date(hk.lastWorkoutEndISO).getTime();
        if (workoutEndAge < 60 * 60 * 1000 && workoutEndAge > 0) {
          log.debug(
            `[${template.windowKey}] Skipping — Sensei finished ${hk.lastWorkoutType ?? "workout"} ${Math.round(workoutEndAge / 60_000)} min ago`,
          );
          if (!stopped) {
            timer = setTimeout(() => void fire(), liveIntervalMs);
          }
          return;
        }
      }

      // Adjust water reminder interval: increase frequency if Sensei is active
      if (template.configKey === "water" && hk.activeEnergyKcal && hk.activeEnergyKcal > 300) {
        nextIntervalMs = Math.max(liveIntervalMs * 0.7, 30 * 60_000); // At least 30min
        log.debug(
          `[${template.windowKey}] Active day (${hk.activeEnergyKcal.toFixed(0)} kcal) — water interval adjusted to ${Math.round(nextIntervalMs / 60_000)} min`,
        );
      }
      // 1. Perform Ping Check if required
      if (liveCfg.requirePing && liveCfg.pingIp) {
        log.debug(`[${template.windowKey}] Pinging ${liveCfg.pingIp}...`);
        try {
          const isWindows = process.platform === "win32";
          const pingCmd = isWindows
            ? `ping -n 1 -w 1000 ${liveCfg.pingIp}`
            : `ping -c 1 -W 1 ${liveCfg.pingIp}`;
          await execAsync(pingCmd, { timeout: 2000 });
        } catch {
          log.debug(`[${template.windowKey}] Ping to ${liveCfg.pingIp} failed, skipping reminder.`);
          // Schedule next occurrence
          if (!stopped) {
            timer = setTimeout(() => void fire(), liveIntervalMs);
          }
          return;
        }
      }

      try {
        const notificationText = await generateNotificationText(
          template,
          llmOpts.cfg,
          llmOpts.agentId,
        );
        await onTrigger({
          windowKey: template.windowKey,
          notificationText,
          title: template.title,
        });
      } catch {
        // Non-critical — don't crash
      }
    }

    // Schedule next occurrence with adjusted interval
    if (!stopped) {
      timer = setTimeout(() => void fire(), nextIntervalMs);
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

  // Add ±10% deterministic jitter to avoid simultaneous fires
  ensureDailySeed();
  const jitter = initialMs * 0.1 * (rng.next() * 2 - 1);
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
 * Each reminder calls the LLM to generate a unique Arona-voice notification,
 * then delivers it via the callback to all linked platforms + iOS app.
 * Falls back to pre-written templates if the LLM call fails.
 *
 * @param onTrigger - Callback to deliver health notifications to all platforms.
 * @param opts.cfg - ShittimChest config (for model resolution).
 * @param opts.agentId - Agent ID (for model resolution).
 * @returns Handle with stop() and restart() for lifecycle management.
 */
export function startHealthScheduler(
  onTrigger: HealthTrigger,
  opts: { cfg: ShittimChestConfig; agentId: string },
): HealthSchedulerHandle {
  let stops: Array<(() => void) | null> = [];

  function start() {
    const config = getHealthConfig();
    stops = TEMPLATES.map((t) =>
      scheduleReminder(t, config, onTrigger, { cfg: opts.cfg, agentId: opts.agentId }),
    );
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

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

const execAsync = promisify(exec);

const log = createSubsystemLogger("health-scheduler");

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
    title: "💧 Nhắc uống nước",
    buildLlmPrompt: () =>
      "Arona nhắc Sensei uống nước. Đã lâu rồi chưa uống nước, cơ thể cần hydrate. Viết 1-2 câu ngắn gọn bằng giọng Arona dễ thương, quan tâm. Có thể dùng emoji. CHỈ trả lời nội dung tin nhắn, không giải thích gì thêm.",
    fallbackTexts: [
      "Sensei~! Uống nước đi nè~ Lâu rồi chưa uống nước, cơ thể cần hydrate để hoạt động tốt nha! 💧",
      "Munya~! Sensei ơi uống nước đi! Arona lo lắng lắm... Đừng quên chăm sóc bản thân nha~ 💦",
      "Sensei! Đã đến lúc uống nước rồi nè~ Hydration quan trọng lắm đó! Arona nhắc Sensei nè ☺️💧",
      "Ding dong~! Arona nhắc Sensei uống nước nè! Một ly nước sẽ giúp Sensei tỉnh táo hơn đó~ 🥤",
    ],
  },
  {
    configKey: "eyes",
    windowKey: "health-eyes",
    initialDelayFraction: 0.9,
    title: "👀 Nghỉ mắt",
    buildLlmPrompt: () =>
      "Arona nhắc Sensei nghỉ mắt. Sensei nhìn màn hình lâu rồi, nên áp dụng quy tắc 20-20-20 (nhìn xa 20 feet trong 20 giây). Viết 1-2 câu ngắn gọn bằng giọng Arona nhẹ nhàng, quan tâm. Có thể dùng emoji. CHỈ trả lời nội dung tin nhắn, không giải thích gì thêm.",
    fallbackTexts: [
      "Sensei ơi~ Nhìn xa 20 feet (6m) trong 20 giây nha! Mắt Sensei cần được nghỉ ngơi~ 👀✨",
      "Munya... Sensei nhìn màn hình lâu quá rồi! Nghỉ mắt một chút đi nha~ Nhìn ra xa 20 giây là được! 👁️",
      "Sensei~! Arona nhắc nghỉ mắt nè! Quy tắc 20-20-20: mỗi 20 phút, nhìn xa 20 feet, trong 20 giây~ 👀💫",
      "Break time cho mắt nè Sensei! Nhìn ra cửa sổ hoặc nhìn xa một chút nha~ Mắt Sensei quan trọng lắm! ✨",
    ],
  },
  {
    configKey: "movement",
    windowKey: "health-movement",
    initialDelayFraction: 0.83,
    title: "🏃 Vận động",
    buildLlmPrompt: () => {
      const hk = getHealthKitData();
      const stepInfo = hk.steps !== null ? ` Hôm nay Sensei đã đi được ${hk.steps} bước.` : "";
      const energyInfo = hk.activeEnergyKcal
        ? ` Đã đốt ${hk.activeEnergyKcal.toFixed(0)} kcal hôm nay.`
        : "";
      const hrInfo = hk.heartRate ? ` Nhịp tim hiện tại: ${hk.heartRate} BPM.` : "";
      return `Arona nhắc Sensei đứng dậy vận động. Sensei ngồi lâu quá rồi, cần stretching, đi lại.${stepInfo}${energyInfo}${hrInfo} Viết 1-2 câu ngắn gọn bằng giọng Arona dễ thương, lo lắng cho sức khỏe Sensei. Nếu số bước > 2000 thì khen Sensei một chút, chưa đủ thì nhắc nhở đi lại nhiều hơn. Có thể dùng emoji. CHỈ trả lời nội dung tin nhắn, không giải thích gì thêm.`;
    },
    fallbackTexts: [
      "Sensei ơi! Đứng dậy vận động một chút đi nha~ Ngồi lâu không tốt cho lưng đâu! Stretching đi~ 🏃‍♂️",
      "Munya~! Sensei ngồi lâu quá rồi! Đứng dậy đi lại, stretching một chút nha! Arona lo cho sức khỏe Sensei lắm~ 💪",
      "Movement break nè Sensei! Đứng dậy, đi lại, xoay người một chút~ Cơ thể Sensei sẽ cảm ơn đó! 🧘",
      "Sensei~! Arona nhắc vận động nè! Đứng dậy stretch cái lưng, xoay cổ, đi bộ vài bước nha~ 🏋️",
    ],
  },
  {
    configKey: "sleep",
    windowKey: "health-sleep",
    initialDelayFraction: 0, // calculated dynamically
    title: "😴 Nhắc đi ngủ",
    buildLlmPrompt: () => {
      const hk = getHealthKitData();
      const sleepInfo = hk.sleepHours
        ? ` Đêm qua Sensei ngủ ${hk.sleepHours.toFixed(1)} tiếng (${hk.sleepQuality ?? "unknown"}).`
        : "";
      const stepsInfo = hk.steps !== null ? ` Hôm nay Sensei đã đi ${hk.steps} bước.` : "";
      return `Đã khuya rồi. Arona nhắc Sensei chuẩn bị đi ngủ, ngày mai còn cần năng lượng.${sleepInfo}${stepsInfo} Nếu đêm qua ngủ ít thì nhắc nhẹ hôm nay phải ngủ sớm hơn. Viết 1-2 câu dịu dàng, lo lắng, buồn ngủ kiểu Arona. Arona cũng buồn ngủ. Có thể dùng emoji. CHỈ trả lời nội dung tin nhắn, không giải thích gì thêm.`;
    },
    fallbackTexts: [
      "Sensei ơi... đã khuya rồi nè... Chuẩn bị đi ngủ đi nha, ngày mai còn cần năng lượng mà~ Arona cũng buồn ngủ lắm rồi... Munya... 🌙💤",
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

  // Fallback: random pre-written template
  return template.fallbackTexts[Math.floor(Math.random() * template.fallbackTexts.length)];
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
  target.setHours(hour, Math.floor(Math.random() * 15), 0, 0); // randomize minutes 0-14
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

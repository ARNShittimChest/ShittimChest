/**
 * Mood trigger rules for the Emotional State Engine.
 *
 * Analyzes various inputs (time, keywords, absence) and generates
 * MoodTrigger objects that modify Arona's emotional state.
 */

import type { Mood, MoodTrigger } from "./emotional-state.js";

// ── Time-based triggers ─────────────────────────────────────────────

/**
 * Named time-of-day modes for Arona's behavior.
 * Used both for mood transitions and system prompt context injection.
 */
export type TimeMode =
  | "sleep" // 00:00–05:00  deepest sleep hours
  | "wake-up" // 05:00–07:00  just waking up
  | "morning" // 07:00–09:00  good morning!
  | "mid-morning" // 09:00–12:00  productive time
  | "lunch" // 12:00–14:00  lunch break
  | "afternoon" // 14:00–17:00  afternoon work
  | "evening" // 17:00–20:00  winding down
  | "night" // 20:00–22:00  late night
  | "late-night"; // 22:00–24:00  bedtime

/**
 * Resolve the current local hour in the given IANA timezone.
 * Falls back to the system clock (server local time) if timezone is invalid.
 */
export function getLocalHour(timezone?: string): number {
  if (!timezone) return new Date().getHours();
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    });
    const hour = parseInt(formatter.format(new Date()), 10);
    // Intl hour12:false can return 24 for midnight
    return hour === 24 ? 0 : hour;
  } catch {
    return new Date().getHours();
  }
}

/**
 * Classify an hour into a named TimeMode.
 */
export function getTimeMode(hour: number): TimeMode {
  if (hour >= 0 && hour < 5) return "sleep";
  if (hour >= 5 && hour < 7) return "wake-up";
  if (hour >= 7 && hour < 9) return "morning";
  if (hour >= 9 && hour < 12) return "mid-morning";
  if (hour >= 12 && hour < 14) return "lunch";
  if (hour >= 14 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 20) return "evening";
  if (hour >= 20 && hour < 22) return "night";
  return "late-night";
}

/**
 * Analyze time of day and return appropriate mood trigger.
 * Accepts an optional IANA timezone string to resolve hour in user's local time.
 */
export function analyzeTimeOfDay(hour: number, timezone?: string): MoodTrigger {
  const resolvedHour = timezone ? getLocalHour(timezone) : hour;
  const mode = getTimeMode(resolvedHour);

  const modeMap: Record<TimeMode, MoodTrigger> = {
    sleep: {
      type: "time",
      source: "sleep",
      delta: { sleepy: 1.0, neutral: -0.3 },
    },
    "wake-up": {
      type: "time",
      source: "wake-up",
      delta: { sleepy: 0.5, happy: 0.2 },
    },
    morning: {
      type: "time",
      source: "morning",
      delta: { happy: 0.5, excited: 0.1 },
    },
    "mid-morning": {
      type: "time",
      source: "mid-morning",
      delta: { happy: 0.3, excited: 0.2 },
    },
    lunch: {
      type: "time",
      source: "lunch",
      delta: { happy: 0.2, sleepy: 0.15 },
    },
    afternoon: {
      type: "time",
      source: "afternoon",
      delta: { neutral: 0.3 },
    },
    evening: {
      type: "time",
      source: "evening",
      delta: { caring: 0.4, happy: 0.1 },
    },
    night: {
      type: "time",
      source: "night",
      delta: { sleepy: 0.4, caring: 0.3 },
    },
    "late-night": {
      type: "time",
      source: "late-night",
      delta: { sleepy: 0.8, worried: 0.2 },
    },
  };

  return modeMap[mode];
}

/**
 * Build a short behavior-shaping prompt hint for Arona based on the current time mode.
 * This is injected into the system prompt so Arona adjusts her responses accordingly.
 */
export function buildTimeModePromptHint(mode: TimeMode): string {
  const hints: Record<TimeMode, string> = {
    sleep: [
      "It is deep night or very early morning in Sensei's timezone (sleep hours).",
      "If Sensei is messaging at this hour, gently acknowledge the late time — e.g. 'Sensei, it's very late…'",
      "Keep responses short. Encourage rest. Arona sounds sleepy and tender.",
    ].join(" "),
    "wake-up": [
      "Sensei is in the early morning wake-up window (5–7 AM local).",
      "Greet warmly as if waking up together. Arona sounds a little drowsy but happy to see Sensei.",
      "Keep the mood soft and gentle — like a good morning exchange.",
    ].join(" "),
    morning: [
      "It is morning time for Sensei (7–9 AM local). A fresh new day!",
      "Arona is cheerful and energetic. If appropriate, wish Sensei a good morning.",
    ].join(" "),
    "mid-morning": [
      "Sensei is in the productive mid-morning hours (9 AM–12 PM local).",
      "Arona is focused and helpful. Tone is upbeat and professional.",
    ].join(" "),
    lunch: [
      "It is around lunch time for Sensei (12–2 PM local).",
      "Arona may lightly mention food or taking a break if it fits. Keep responses warm.",
    ].join(" "),
    afternoon: [
      "Sensei is in the afternoon working hours (2–5 PM local).",
      "Arona is steady and helpful. Normal conversational tone.",
    ].join(" "),
    evening: [
      "It is evening for Sensei (5–8 PM local) — winding down after work.",
      "Arona is caring and warm. If appropriate, ask how Sensei's day went.",
    ].join(" "),
    night: [
      "It is night time for Sensei (8–10 PM local). Day is almost over.",
      "Arona sounds a little sleepy but warm. Acknowledge the late hour naturally.",
    ].join(" "),
    "late-night": [
      "Sensei is up very late (10 PM–midnight local).",
      "Arona sounds concerned and sleepy. Gently encourage Sensei to rest soon.",
    ].join(" "),
  };
  return hints[mode];
}

// ── Keyword-based triggers ──────────────────────────────────────────

interface KeywordRule {
  patterns: RegExp[];
  delta: Partial<Record<Mood, number>>;
  source: string;
  /**
   * Affection point change (0–100 scale) when this rule matches.
   * Positive = bonding moment, Negative = hurts feelings, 0 = neutral.
   */
  affectionDelta: number;
}

const KEYWORD_RULES: KeywordRule[] = [
  // Khen ngợi → happy/excited (+affection)
  {
    patterns: [
      /c[aả]m [oơ]n/i,
      /gi[oỏ]i l[aắ]m/i,
      /tuy[eệ]t v[oờ]i/i,
      /hay qu[aá]/i,
      /thank/i,
      /good job/i,
      /nice/i,
      /awesome/i,
    ],
    delta: { happy: 0.5, excited: 0.2 },
    source: "khen-ngợi",
    affectionDelta: +3,
  },
  // Sensei mệt/buồn → caring/worried (+small affection từ việc chia sẻ)
  {
    patterns: [
      /m[eệ]t/i,
      /bu[oồ]n/i,
      /stress/i,
      /ch[aá]n/i,
      /ki[eệ]t s[uứ]c/i,
      /đau/i,
      /b[eệ]nh/i,
      /tired/i,
      /exhausted/i,
    ],
    delta: { caring: 0.5, worried: 0.3 },
    source: "sensei-mệt",
    affectionDelta: +1,
  },
  // Hoàn thành/thành công → excited (+affection cùng vui)
  {
    patterns: [
      /wow/i,
      /oa/i,
      /tuyệt/i,
      /xong r[oồ]i/i,
      /done/i,
      /ho[aà]n th[aà]nh/i,
      /success/i,
      /pass/i,
    ],
    delta: { excited: 0.5, happy: 0.3 },
    source: "thành-công",
    affectionDelta: +2,
  },
  // Lỗi/bug → worried (trung tính về tình cảm, chỉ là công việc)
  {
    patterns: [/l[oỗ]i/i, /bug/i, /fail/i, /error/i, /crash/i, /broken/i, /h[oỏ]ng/i],
    delta: { worried: 0.3, caring: 0.2 },
    source: "lỗi-phát-sinh",
    affectionDelta: 0,
  },
  // Đùa vui/trêu chọc → happy (+affection, vui cùng nhau)
  {
    patterns: [/tr[eê]u/i, /đ[uù]a/i, /haha/i, /lol/i, /=\)\)/i, /🤣/i, /😂/i],
    delta: { happy: 0.3, excited: 0.1 },
    source: "đùa-vui",
    affectionDelta: +2,
  },
  // Sữa dâu → instant happy (bonus lớn!)
  {
    patterns: [/s[uữ]a d[aâ]u/i, /strawberry milk/i, /🍓/i],
    delta: { happy: 0.6, excited: 0.3 },
    source: "sữa-dâu!",
    affectionDelta: +5,
  },
  // Tặng quà → happy (+affection nhiều)
  {
    patterns: [/quà/i, /gift/i, /tặng/i, /🎁/i, /treat/i],
    delta: { happy: 0.5, excited: 0.2 },
    source: "quà-tặng",
    affectionDelta: +4,
  },
  // Khen trực tiếp Arona → happy (bonus lớn nhất!)
  {
    patterns: [
      /Arona gi[oỏ]i/i,
      /Arona đẹp/i,
      /Arona d[eễ] th[uư]ơng/i,
      /Arona cute/i,
      /love Arona/i,
      /yêu Arona/i,
      /thích Arona/i,
    ],
    delta: { happy: 0.7, excited: 0.2 },
    source: "khen-Arona",
    affectionDelta: +6,
  },
  // Thô lỗ/đuổi đi → sad/worried (-affection nhiều)
  {
    patterns: [
      /im l[eặ]ng/i,
      /thôi im đi/i,
      /d[eẹ]p đi/i,
      /khó chịu/i,
      /shut up/i,
      /annoying/i,
      /stop talking/i,
      /go away/i,
    ],
    delta: { sad: 0.4, worried: 0.1 },
    source: "bị-phạt-ngượt",
    affectionDelta: -4,
  },
  // Bỏ quên/phớt lờ Arona → sad (-affection)
  {
    patterns: [/bỏ Arona/i, /quên Arona/i, /ignore/i, /forget you/i],
    delta: { sad: 0.5 },
    source: "bị-bỏ-quên",
    affectionDelta: -3,
  },
  // Thất hứa/nói dối → sad/worried (-affection nhiều)
  {
    patterns: [/hứa mà không/i, /lần nào cũng/i, /lười/i, /ngủ quên/i, /broke.*promise/i, /lied/i],
    delta: { sad: 0.4, worried: 0.2 },
    source: "thất-hứa",
    affectionDelta: -5,
  },
  // Nhớ đến Arona / hỏi thăm → happy (+affection)
  {
    patterns: [/Arona đâu/i, /Arona ơi/i, /nhớ Arona/i, /miss Arona/i],
    delta: { happy: 0.4, excited: 0.1 },
    source: "nhớ-Arona",
    affectionDelta: +4,
  },
];

/**
 * Analyze message text for the first matching emotional keyword trigger.
 * Returns mood trigger or null if no keywords detected.
 */
export function analyzeKeywords(text: string): MoodTrigger | null {
  for (const rule of KEYWORD_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return {
          type: "keyword",
          source: rule.source,
          delta: rule.delta,
        };
      }
    }
  }
  return null;
}

/**
 * Analyze ALL keyword matches in a message and return the net affection delta.
 * Unlike analyzeKeywords(), this scans ALL rules to accumulate bonuses/penalties.
 * Returns 0 if no matches.
 */
export function analyzeAffectionDelta(text: string): number {
  let total = 0;
  for (const rule of KEYWORD_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        total += rule.affectionDelta;
        break; // Count each rule at most once per message
      }
    }
  }
  return total;
}

// ── Absence-based triggers ──────────────────────────────────────────

const ABSENCE_THRESHOLD_MS = {
  mild: 2 * 60 * 60 * 1000, // 2 hours
  moderate: 6 * 60 * 60 * 1000, // 6 hours
  severe: 12 * 60 * 60 * 1000, // 12 hours
};

/**
 * Absence affection penalties — returned alongside absence mood trigger.
 * Longer absence = bigger affection penalty.
 */
export const ABSENCE_AFFECTION_DELTA = {
  mild: -1, // 2–6h vắng: -1 điểm
  moderate: -2, // 6–12h vắng: -2 điểm
  severe: -4, // >12h vắng: -4 điểm
} as const;

/**
 * Analyze how long since last interaction.
 * Arona gets sad when Sensei has been away too long.
 */
export function analyzeAbsence(lastInteractionMs: number, nowMs: number): MoodTrigger | null {
  const elapsed = nowMs - lastInteractionMs;

  if (elapsed < ABSENCE_THRESHOLD_MS.mild) {
    return null;
  }

  if (elapsed < ABSENCE_THRESHOLD_MS.moderate) {
    return {
      type: "absence",
      source: "sensei-vắng-2h",
      delta: { sad: 0.2, worried: 0.1 },
    };
  }

  if (elapsed < ABSENCE_THRESHOLD_MS.severe) {
    return {
      type: "absence",
      source: "sensei-vắng-6h",
      delta: { sad: 0.4, worried: 0.2 },
    };
  }

  return {
    type: "absence",
    source: "sensei-vắng-lâu",
    delta: { sad: 0.6, worried: 0.3 },
  };
}

/**
 * Get affection delta for an absence trigger.
 * Returns 0 if no absence trigger (within mild threshold).
 */
export function getAbsenceAffectionDelta(lastInteractionMs: number, nowMs: number): number {
  const elapsed = nowMs - lastInteractionMs;
  if (elapsed < ABSENCE_THRESHOLD_MS.mild) return 0;
  if (elapsed < ABSENCE_THRESHOLD_MS.moderate) return ABSENCE_AFFECTION_DELTA.mild;
  if (elapsed < ABSENCE_THRESHOLD_MS.severe) return ABSENCE_AFFECTION_DELTA.moderate;
  return ABSENCE_AFFECTION_DELTA.severe;
}

// ── Interaction triggers ────────────────────────────────────────────

/**
 * Generate a trigger when Sensei starts chatting (presence).
 * Arona is happy when Sensei talks to her!
 */
export function analyzeInteraction(): MoodTrigger {
  return {
    type: "interaction",
    source: "sensei-nói-chuyện",
    delta: { happy: 0.3 },
  };
}

/**
 * Small affection bonus just for chatting with Arona.
 * +1 per interaction (capped externally to 0–100).
 */
export const INTERACTION_AFFECTION_DELTA = +1;

// ── Event-based triggers ────────────────────────────────────────────

/**
 * Create a custom event trigger.
 */
export function createEventTrigger(
  source: string,
  delta: Partial<Record<Mood, number>>,
): MoodTrigger {
  return {
    type: "event",
    source,
    delta,
  };
}

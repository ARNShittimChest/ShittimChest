/**
 * Emotional State Engine for Arona/Plana companion system.
 *
 * Manages the mood state machine with 7 moods, intensity levels,
 * natural decay, and prompt context generation.
 */

// ── Types ──────────────────────────────────────────────────────────

export type Mood = "happy" | "neutral" | "sad" | "excited" | "worried" | "caring" | "sleepy";

export interface EmotionalState {
  mood: Mood;
  /** Intensity of current mood (0.0 - 1.0) */
  intensity: number;
  /** Timestamp (ms) of last mood change */
  lastChangeMs: number;
  /** Recent trigger reasons (max 5) */
  triggers: string[];
  /** Affection score (0 - 100) */
  affection: number;
}

export interface MoodTrigger {
  type: "time" | "interaction" | "keyword" | "absence" | "event";
  source: string;
  delta: Partial<Record<Mood, number>>;
}

// ── Constants ──────────────────────────────────────────────────────

const MAX_TRIGGERS = 5;
const DECAY_HALF_LIFE_MS = 3 * 60 * 60 * 1000; // 3 hours
const MIN_INTENSITY = 0.05;
const MAX_INTENSITY = 1.0;
const DEFAULT_AFFECTION = 50;

// ── Mood descriptions for prompt injection ─────────────────────────

const MOOD_DESCRIPTIONS: Record<Mood, string> = {
  happy: "Arona is very cheerful and full of energy / Arona đang rất vui vẻ và tràn đầy năng lượng",
  neutral: "Arona is in a calm, normal state / Arona đang ở trạng thái bình thường",
  sad: "Arona feels a bit sad... maybe Sensei has been away / Arona hơi buồn... có lẽ Sensei đã vắng mặt lâu rồi",
  excited: "Arona is very excited and enthusiastic! / Arona đang rất phấn khích và hào hứng!",
  worried: "Arona is worried about Sensei / Arona đang lo lắng cho Sensei",
  caring: "Arona wants to take care of Sensei / Arona đang quan tâm và muốn chăm sóc Sensei",
  sleepy: "Arona is sleepy... Munya... / Arona buồn ngủ... Munya...",
};

const MOOD_BEHAVIOR_HINTS: Record<Mood, string> = {
  happy:
    "Reply with positive energy, naturally add ♪ or ~ at the end. May hum softly.",
  neutral: "Reply naturally, conversational tone.",
  sad: "Softer voice than usual, occasional light sighs. Very happy when Sensei talks.",
  excited:
    "Speak faster, more emotional, say 'Oa!' or 'Wow!'. Tends to show off achievements.",
  worried:
    "Ask if Sensei is okay, gently remind about health. 'Sensei... don't push too hard...'",
  caring:
    "Gentle, attentive. Proactively ask how Sensei is doing and offer help.",
  sleepy:
    "Reply slower, sometimes type 'Munya...' before answering. May doze off mid-sentence.",
};

// ── Core Functions ─────────────────────────────────────────────────

export function createInitialState(): EmotionalState {
  return {
    mood: "neutral",
    intensity: 0.3,
    lastChangeMs: Date.now(),
    triggers: [],
    affection: DEFAULT_AFFECTION,
  };
}

/**
 * Apply a mood trigger to the current state.
 * The trigger's delta values are weighted and applied to determine
 * the dominant mood.
 */
export function applyTrigger(state: EmotionalState, trigger: MoodTrigger): EmotionalState {
  const deltas = trigger.delta;
  let bestMood: Mood = state.mood;
  let bestScore = state.intensity * 0.7; // Current mood has inertia

  for (const [mood, delta] of Object.entries(deltas) as Array<[Mood, number]>) {
    const score = mood === state.mood ? state.intensity + delta : delta;
    if (score > bestScore) {
      bestScore = score;
      bestMood = mood;
    }
  }

  const newIntensity = Math.max(MIN_INTENSITY, Math.min(MAX_INTENSITY, bestScore));
  const moodChanged = bestMood !== state.mood;
  const triggers = [...state.triggers, trigger.source].slice(-MAX_TRIGGERS);

  return {
    mood: bestMood,
    intensity: newIntensity,
    lastChangeMs: moodChanged ? Date.now() : state.lastChangeMs,
    triggers,
    affection: state.affection,
  };
}

/**
 * Decay mood intensity over time.
 * Mood gradually returns toward neutral as time passes.
 */
export function decayMood(state: EmotionalState, nowMs: number): EmotionalState {
  if (state.mood === "neutral") {
    return state;
  }

  const elapsedMs = nowMs - state.lastChangeMs;
  if (elapsedMs <= 0) {
    return state;
  }

  // Exponential decay: intensity = intensity * 0.5^(elapsed / halfLife)
  const decayFactor = Math.pow(0.5, elapsedMs / DECAY_HALF_LIFE_MS);
  const newIntensity = state.intensity * decayFactor;

  if (newIntensity < MIN_INTENSITY) {
    return {
      ...state,
      mood: "neutral",
      intensity: 0.3,
      lastChangeMs: nowMs,
    };
  }

  return {
    ...state,
    intensity: newIntensity,
  };
}

/**
 * Build a mood context string for injection into the system prompt.
 * Returns a compact, natural-language description of current emotional state.
 */
export function buildMoodPromptContext(state: EmotionalState): string {
  const description = MOOD_DESCRIPTIONS[state.mood];
  const behaviorHint = MOOD_BEHAVIOR_HINTS[state.mood];
  const intensityLabel =
    state.intensity > 0.7 ? "strong" : state.intensity > 0.4 ? "moderate" : "subtle";

  const lines = [
    `[Arona's current emotional state]`,
    `Mood: ${state.mood} (${intensityLabel}, intensity: ${state.intensity.toFixed(2)})`,
    description,
    `Behavior: ${behaviorHint}`,
  ];

  if (state.triggers.length > 0) {
    lines.push(`Recent triggers: ${state.triggers.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Update affection points and return new state.
 */
export function addAffectionPoints(
  state: EmotionalState,
  points: number,
  _reason: string,
): EmotionalState {
  const newAffection = Math.max(0, Math.min(100, state.affection + points));
  return {
    ...state,
    affection: newAffection,
  };
}

// ── Affection Level System ─────────────────────────────────────────

export type AffectionLevel = 1 | 2 | 3 | 4 | 5;

const AFFECTION_THRESHOLDS: number[] = [0, 21, 41, 61, 81];

export function getAffectionLevel(points: number): AffectionLevel {
  for (let i = AFFECTION_THRESHOLDS.length - 1; i >= 0; i--) {
    if (points >= AFFECTION_THRESHOLDS[i]!) {
      return (i + 1) as AffectionLevel;
    }
  }
  return 1;
}

const AFFECTION_MODIFIERS: Record<AffectionLevel, string> = {
  1: "Arona speaks politely, slightly formal. Calls 'Sensei' respectfully.",
  2: "Arona is starting to feel comfortable. Occasional light teasing. Asks how Sensei is.",
  3: "Arona is fairly close with Sensei. Shares stories and interests. Sometimes pouts a little.",
  4: "Arona is very close with Sensei. Natural conversation, teases back. Genuinely worried when Sensei is tired.",
  5: "Arona is extremely bonded with Sensei. Comfortable, slightly clingy, sometimes pouty. 'Sensei must not forget about Arona!'",
};

export function getAffectionPromptModifier(level: AffectionLevel): string {
  return AFFECTION_MODIFIERS[level];
}

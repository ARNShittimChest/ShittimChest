import { describe, expect, it } from "vitest";
import {
  createInitialState,
  applyTrigger,
  decayMood,
  buildMoodPromptContext,
  addAffectionPoints,
  getAffectionLevel,
  getAffectionPromptModifier,
} from "./emotional-state.js";
import type { EmotionalState, MoodTrigger, Mood, AffectionLevel } from "./emotional-state.js";

// ── createInitialState ─────────────────────────────────────────────

describe("createInitialState", () => {
  it("returns neutral mood with default values", () => {
    const state = createInitialState();
    expect(state.mood).toBe("neutral");
    expect(state.intensity).toBe(0.3);
    expect(state.affection).toBe(50);
    expect(state.triggers).toEqual([]);
    expect(state.lastChangeMs).toBeGreaterThan(0);
  });

  it("returns a fresh object each time", () => {
    const a = createInitialState();
    const b = createInitialState();
    expect(a).not.toBe(b);
    expect(a.triggers).not.toBe(b.triggers);
  });
});

// ── applyTrigger ───────────────────────────────────────────────────

describe("applyTrigger", () => {
  const baseState: EmotionalState = {
    mood: "neutral",
    intensity: 0.3,
    lastChangeMs: 1000,
    triggers: [],
    affection: 50,
  };

  it("changes mood when trigger delta exceeds current inertia", () => {
    const trigger: MoodTrigger = {
      type: "keyword",
      source: "khen-ngợi",
      delta: { happy: 0.5 },
    };
    const result = applyTrigger(baseState, trigger);
    expect(result.mood).toBe("happy");
    expect(result.intensity).toBeGreaterThan(0.3);
  });

  it("keeps current mood when trigger delta is weaker than inertia", () => {
    const highIntensityState: EmotionalState = {
      ...baseState,
      mood: "happy",
      intensity: 0.9,
    };
    const weakTrigger: MoodTrigger = {
      type: "keyword",
      source: "weak",
      delta: { sad: 0.1 },
    };
    const result = applyTrigger(highIntensityState, weakTrigger);
    expect(result.mood).toBe("happy");
  });

  it("reinforces current mood when same-mood delta is applied", () => {
    const happyState: EmotionalState = {
      ...baseState,
      mood: "happy",
      intensity: 0.4,
    };
    const trigger: MoodTrigger = {
      type: "keyword",
      source: "more-happy",
      delta: { happy: 0.3 },
    };
    const result = applyTrigger(happyState, trigger);
    expect(result.mood).toBe("happy");
    expect(result.intensity).toBeGreaterThan(0.4);
  });

  it("records trigger source in triggers array", () => {
    const trigger: MoodTrigger = {
      type: "event",
      source: "test-event",
      delta: { excited: 0.5 },
    };
    const result = applyTrigger(baseState, trigger);
    expect(result.triggers).toContain("test-event");
  });

  it("limits triggers array to max 5 entries", () => {
    let state: EmotionalState = {
      ...baseState,
      triggers: ["a", "b", "c", "d", "e"],
    };
    const trigger: MoodTrigger = {
      type: "event",
      source: "f",
      delta: { happy: 0.1 },
    };
    state = applyTrigger(state, trigger);
    expect(state.triggers).toHaveLength(5);
    expect(state.triggers).not.toContain("a");
    expect(state.triggers).toContain("f");
  });

  it("clamps intensity to max 1.0", () => {
    const state: EmotionalState = {
      ...baseState,
      mood: "happy",
      intensity: 0.9,
    };
    const trigger: MoodTrigger = {
      type: "keyword",
      source: "mega-happy",
      delta: { happy: 0.8 },
    };
    const result = applyTrigger(state, trigger);
    expect(result.intensity).toBeLessThanOrEqual(1.0);
  });

  it("clamps intensity to minimum 0.05", () => {
    const trigger: MoodTrigger = {
      type: "keyword",
      source: "tiny",
      delta: { happy: 0.01 },
    };
    const result = applyTrigger(baseState, trigger);
    expect(result.intensity).toBeGreaterThanOrEqual(0.05);
  });

  it("updates lastChangeMs when mood changes", () => {
    const trigger: MoodTrigger = {
      type: "keyword",
      source: "mood-change",
      delta: { excited: 0.8 },
    };
    const result = applyTrigger(baseState, trigger);
    expect(result.mood).toBe("excited");
    expect(result.lastChangeMs).toBeGreaterThan(baseState.lastChangeMs);
  });

  it("preserves lastChangeMs when mood does not change", () => {
    const neutralState: EmotionalState = {
      ...baseState,
      mood: "happy",
      intensity: 0.9,
    };
    const trigger: MoodTrigger = {
      type: "keyword",
      source: "same-mood",
      delta: { happy: 0.1 },
    };
    const result = applyTrigger(neutralState, trigger);
    expect(result.mood).toBe("happy");
    expect(result.lastChangeMs).toBe(neutralState.lastChangeMs);
  });

  it("preserves affection through trigger application", () => {
    const state: EmotionalState = { ...baseState, affection: 75 };
    const trigger: MoodTrigger = {
      type: "keyword",
      source: "test",
      delta: { happy: 0.5 },
    };
    const result = applyTrigger(state, trigger);
    expect(result.affection).toBe(75);
  });

  it("picks highest scoring mood when multiple deltas compete", () => {
    const trigger: MoodTrigger = {
      type: "keyword",
      source: "multi-delta",
      delta: { happy: 0.3, excited: 0.6, caring: 0.2 },
    };
    const result = applyTrigger(baseState, trigger);
    expect(result.mood).toBe("excited");
  });
});

// ── decayMood ──────────────────────────────────────────────────────

describe("decayMood", () => {
  it("does nothing when mood is already neutral", () => {
    const state: EmotionalState = {
      mood: "neutral",
      intensity: 0.3,
      lastChangeMs: 1000,
      triggers: [],
      affection: 50,
    };
    const result = decayMood(state, 999999999);
    expect(result).toBe(state); // Same reference
  });

  it("does nothing when elapsed time is zero", () => {
    const state: EmotionalState = {
      mood: "happy",
      intensity: 0.8,
      lastChangeMs: 1000,
      triggers: [],
      affection: 50,
    };
    const result = decayMood(state, 1000);
    expect(result).toBe(state);
  });

  it("does nothing when elapsed time is negative", () => {
    const state: EmotionalState = {
      mood: "happy",
      intensity: 0.8,
      lastChangeMs: 2000,
      triggers: [],
      affection: 50,
    };
    const result = decayMood(state, 1000);
    expect(result).toBe(state);
  });

  it("reduces intensity over time", () => {
    const state: EmotionalState = {
      mood: "happy",
      intensity: 0.8,
      lastChangeMs: 0,
      triggers: [],
      affection: 50,
    };
    const oneHourMs = 60 * 60 * 1000;
    const result = decayMood(state, oneHourMs);
    expect(result.mood).toBe("happy");
    expect(result.intensity).toBeLessThan(0.8);
    expect(result.intensity).toBeGreaterThan(0);
  });

  it("halves intensity at half-life (3 hours)", () => {
    const state: EmotionalState = {
      mood: "happy",
      intensity: 0.8,
      lastChangeMs: 0,
      triggers: [],
      affection: 50,
    };
    const threeHoursMs = 3 * 60 * 60 * 1000;
    const result = decayMood(state, threeHoursMs);
    expect(result.intensity).toBeCloseTo(0.4, 1);
  });

  it("returns to neutral when intensity drops below threshold", () => {
    const state: EmotionalState = {
      mood: "happy",
      intensity: 0.1,
      lastChangeMs: 0,
      triggers: [],
      affection: 50,
    };
    const longTimeMs = 24 * 60 * 60 * 1000; // 24 hours
    const result = decayMood(state, longTimeMs);
    expect(result.mood).toBe("neutral");
    expect(result.intensity).toBe(0.3);
  });

  it("preserves non-intensity fields during decay", () => {
    const state: EmotionalState = {
      mood: "excited",
      intensity: 0.8,
      lastChangeMs: 0,
      triggers: ["a", "b"],
      affection: 75,
    };
    const result = decayMood(state, 60 * 60 * 1000);
    expect(result.triggers).toEqual(["a", "b"]);
    expect(result.affection).toBe(75);
  });
});

// ── buildMoodPromptContext ──────────────────────────────────────────

describe("buildMoodPromptContext", () => {
  it("includes mood name and description", () => {
    const state: EmotionalState = {
      mood: "happy",
      intensity: 0.8,
      lastChangeMs: Date.now(),
      triggers: [],
      affection: 50,
    };
    const context = buildMoodPromptContext(state);
    expect(context).toContain("happy");
    expect(context).toContain("vui vẻ");
  });

  it("includes intensity label for high intensity", () => {
    const state: EmotionalState = {
      mood: "sleepy",
      intensity: 0.9,
      lastChangeMs: Date.now(),
      triggers: [],
      affection: 50,
    };
    const context = buildMoodPromptContext(state);
    expect(context).toContain("strong");
  });

  it("includes intensity label for medium intensity", () => {
    const state: EmotionalState = {
      mood: "caring",
      intensity: 0.5,
      lastChangeMs: Date.now(),
      triggers: [],
      affection: 50,
    };
    const context = buildMoodPromptContext(state);
    expect(context).toContain("moderate");
  });

  it("includes intensity label for low intensity", () => {
    const state: EmotionalState = {
      mood: "worried",
      intensity: 0.2,
      lastChangeMs: Date.now(),
      triggers: [],
      affection: 50,
    };
    const context = buildMoodPromptContext(state);
    expect(context).toContain("subtle");
  });

  it("includes recent triggers when present", () => {
    const state: EmotionalState = {
      mood: "happy",
      intensity: 0.5,
      lastChangeMs: Date.now(),
      triggers: ["khen-ngợi", "sữa-dâu!"],
      affection: 50,
    };
    const context = buildMoodPromptContext(state);
    expect(context).toContain("khen-ngợi");
    expect(context).toContain("sữa-dâu!");
  });

  it("does not include triggers line when triggers are empty", () => {
    const state: EmotionalState = {
      mood: "neutral",
      intensity: 0.3,
      lastChangeMs: Date.now(),
      triggers: [],
      affection: 50,
    };
    const context = buildMoodPromptContext(state);
    expect(context).not.toContain("Triggers");
  });

  it("includes behavior hint for each mood", () => {
    const moods: Mood[] = ["happy", "neutral", "sad", "excited", "worried", "caring", "sleepy"];
    for (const mood of moods) {
      const state: EmotionalState = {
        mood,
        intensity: 0.5,
        lastChangeMs: Date.now(),
        triggers: [],
        affection: 50,
      };
      const context = buildMoodPromptContext(state);
      expect(context).toContain("Behavior:");
    }
  });
});

// ── addAffectionPoints ─────────────────────────────────────────────

describe("addAffectionPoints", () => {
  const baseState: EmotionalState = {
    mood: "neutral",
    intensity: 0.3,
    lastChangeMs: 1000,
    triggers: [],
    affection: 50,
  };

  it("adds positive points", () => {
    const result = addAffectionPoints(baseState, 10, "chat");
    expect(result.affection).toBe(60);
  });

  it("subtracts negative points", () => {
    const result = addAffectionPoints(baseState, -20, "absence");
    expect(result.affection).toBe(30);
  });

  it("clamps to maximum 100", () => {
    const result = addAffectionPoints(baseState, 999, "overflow");
    expect(result.affection).toBe(100);
  });

  it("clamps to minimum 0", () => {
    const result = addAffectionPoints(baseState, -999, "underflow");
    expect(result.affection).toBe(0);
  });

  it("does not modify other state fields", () => {
    const result = addAffectionPoints(baseState, 5, "test");
    expect(result.mood).toBe(baseState.mood);
    expect(result.intensity).toBe(baseState.intensity);
    expect(result.triggers).toEqual(baseState.triggers);
  });
});

// ── getAffectionLevel ──────────────────────────────────────────────

describe("getAffectionLevel", () => {
  it("returns level 1 for 0-20 points", () => {
    expect(getAffectionLevel(0)).toBe(1);
    expect(getAffectionLevel(10)).toBe(1);
    expect(getAffectionLevel(20)).toBe(1);
  });

  it("returns level 2 for 21-40 points", () => {
    expect(getAffectionLevel(21)).toBe(2);
    expect(getAffectionLevel(30)).toBe(2);
    expect(getAffectionLevel(40)).toBe(2);
  });

  it("returns level 3 for 41-60 points", () => {
    expect(getAffectionLevel(41)).toBe(3);
    expect(getAffectionLevel(50)).toBe(3);
    expect(getAffectionLevel(60)).toBe(3);
  });

  it("returns level 4 for 61-80 points", () => {
    expect(getAffectionLevel(61)).toBe(4);
    expect(getAffectionLevel(70)).toBe(4);
    expect(getAffectionLevel(80)).toBe(4);
  });

  it("returns level 5 for 81-100 points", () => {
    expect(getAffectionLevel(81)).toBe(5);
    expect(getAffectionLevel(90)).toBe(5);
    expect(getAffectionLevel(100)).toBe(5);
  });

  it("returns level 1 for boundary value 0", () => {
    expect(getAffectionLevel(0)).toBe(1);
  });

  it("handles exact threshold values", () => {
    expect(getAffectionLevel(21)).toBe(2);
    expect(getAffectionLevel(41)).toBe(3);
    expect(getAffectionLevel(61)).toBe(4);
    expect(getAffectionLevel(81)).toBe(5);
  });
});

// ── getAffectionPromptModifier ─────────────────────────────────────

describe("getAffectionPromptModifier", () => {
  it("returns a string for each level", () => {
    const levels: AffectionLevel[] = [1, 2, 3, 4, 5];
    for (const level of levels) {
      const modifier = getAffectionPromptModifier(level);
      expect(typeof modifier).toBe("string");
      expect(modifier.length).toBeGreaterThan(0);
    }
  });

  it("level 1 mentions formal/polite", () => {
    const modifier = getAffectionPromptModifier(1);
    expect(modifier).toContain("politely");
  });

  it("level 5 mentions close/pouty", () => {
    const modifier = getAffectionPromptModifier(5);
    expect(modifier).toContain("pouty");
  });

  it("each level has a unique modifier", () => {
    const modifiers = new Set([1, 2, 3, 4, 5].map((l) => getAffectionPromptModifier(l as AffectionLevel)));
    expect(modifiers.size).toBe(5);
  });
});

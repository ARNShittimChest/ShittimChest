import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInitialState } from "./emotional-state.js";
import type { EmotionalState } from "./emotional-state.js";
import { loadMoodState, loadOrCreateMoodState, saveMoodState } from "./mood-persistence.js";

describe("mood-persistence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arona-mood-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleState: EmotionalState = {
    mood: "happy",
    intensity: 0.7,
    lastChangeMs: 1000,
    triggers: ["khen-ngợi", "sữa-dâu!"],
    affection: 65,
  };

  // ── saveMoodState ────────────────────────────────────────────────

  describe("saveMoodState", () => {
    it("creates .arona directory and saves state file", () => {
      saveMoodState(tmpDir, sampleState);
      const statePath = path.join(tmpDir, ".arona", "mood-state.json");
      expect(fs.existsSync(statePath)).toBe(true);
    });

    it("saved file contains valid JSON", () => {
      saveMoodState(tmpDir, sampleState);
      const statePath = path.join(tmpDir, ".arona", "mood-state.json");
      const raw = fs.readFileSync(statePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.mood).toBe("happy");
      expect(parsed.intensity).toBe(0.7);
      expect(parsed.affection).toBe(65);
    });

    it("overwrites existing state file", () => {
      saveMoodState(tmpDir, sampleState);
      const newState: EmotionalState = { ...sampleState, mood: "sad", intensity: 0.3 };
      saveMoodState(tmpDir, newState);
      const statePath = path.join(tmpDir, ".arona", "mood-state.json");
      const raw = fs.readFileSync(statePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.mood).toBe("sad");
      expect(parsed.intensity).toBe(0.3);
    });

    it("preserves triggers array in saved file", () => {
      saveMoodState(tmpDir, sampleState);
      const statePath = path.join(tmpDir, ".arona", "mood-state.json");
      const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      expect(parsed.triggers).toEqual(["khen-ngợi", "sữa-dâu!"]);
    });

    it("does not crash when writing to non-existent deep path", () => {
      const deepDir = path.join(tmpDir, "deep", "nested", "dir");
      // Should not throw — it creates dirs recursively
      expect(() => saveMoodState(deepDir, sampleState)).not.toThrow();
    });
  });

  // ── loadMoodState ────────────────────────────────────────────────

  describe("loadMoodState", () => {
    it("returns null when no state file exists", () => {
      const result = loadMoodState(tmpDir);
      expect(result).toBeNull();
    });

    it("returns saved state after save", () => {
      saveMoodState(tmpDir, sampleState);
      const result = loadMoodState(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.mood).toBe("happy");
      expect(result!.intensity).toBe(0.7);
      expect(result!.affection).toBe(65);
      expect(result!.triggers).toEqual(["khen-ngợi", "sữa-dâu!"]);
    });

    it("returns null for corrupted JSON", () => {
      const dir = path.join(tmpDir, ".arona");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "mood-state.json"), "not json", "utf-8");
      const result = loadMoodState(tmpDir);
      expect(result).toBeNull();
    });

    it("returns null for JSON missing required fields", () => {
      const dir = path.join(tmpDir, ".arona");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "mood-state.json"),
        JSON.stringify({ mood: "happy" }), // missing intensity, lastChangeMs, etc.
        "utf-8",
      );
      const result = loadMoodState(tmpDir);
      expect(result).toBeNull();
    });

    it("returns null for JSON with wrong types", () => {
      const dir = path.join(tmpDir, ".arona");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "mood-state.json"),
        JSON.stringify({
          mood: 123, // should be string
          intensity: "high", // should be number
          lastChangeMs: "now", // should be number
          triggers: "none", // should be array
          affection: "yes", // should be number
        }),
        "utf-8",
      );
      const result = loadMoodState(tmpDir);
      expect(result).toBeNull();
    });
  });

  // ── loadOrCreateMoodState ────────────────────────────────────────

  describe("loadOrCreateMoodState", () => {
    it("returns saved state when it exists", () => {
      saveMoodState(tmpDir, sampleState);
      const result = loadOrCreateMoodState(tmpDir);
      expect(result.mood).toBe("happy");
      expect(result.intensity).toBe(0.7);
    });

    it("returns initial state when no saved state exists", () => {
      const result = loadOrCreateMoodState(tmpDir);
      expect(result.mood).toBe("neutral");
      expect(result.intensity).toBe(0.3);
      expect(result.affection).toBe(50);
    });

    it("returns initial state when saved state is corrupted", () => {
      const dir = path.join(tmpDir, ".arona");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "mood-state.json"), "{broken", "utf-8");
      const result = loadOrCreateMoodState(tmpDir);
      expect(result.mood).toBe("neutral");
    });
  });

  // ── Round-trip tests ─────────────────────────────────────────────

  describe("round-trip", () => {
    it("saves and loads all mood types correctly", () => {
      const moods = ["happy", "neutral", "sad", "excited", "worried", "caring", "sleepy"] as const;
      for (const mood of moods) {
        const state: EmotionalState = {
          mood,
          intensity: 0.5,
          lastChangeMs: 12345,
          triggers: ["test"],
          affection: 42,
        };
        saveMoodState(tmpDir, state);
        const loaded = loadMoodState(tmpDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.mood).toBe(mood);
      }
    });

    it("preserves state through createInitialState → save → load", () => {
      const initial = createInitialState();
      saveMoodState(tmpDir, initial);
      const loaded = loadMoodState(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.mood).toBe(initial.mood);
      expect(loaded!.intensity).toBe(initial.intensity);
      expect(loaded!.affection).toBe(initial.affection);
    });

    it("handles unicode trigger sources correctly", () => {
      const state: EmotionalState = {
        mood: "happy",
        intensity: 0.5,
        lastChangeMs: 1000,
        triggers: ["khen-ngợi", "sữa-dâu!", "Sensei-vắng-lâu", "đùa-vui"],
        affection: 50,
      };
      saveMoodState(tmpDir, state);
      const loaded = loadMoodState(tmpDir);
      expect(loaded!.triggers).toEqual(state.triggers);
    });

    it("handles extreme affection values at boundaries", () => {
      for (const affection of [0, 1, 50, 99, 100]) {
        const state: EmotionalState = {
          mood: "neutral",
          intensity: 0.3,
          lastChangeMs: 1000,
          triggers: [],
          affection,
        };
        saveMoodState(tmpDir, state);
        const loaded = loadMoodState(tmpDir);
        expect(loaded!.affection).toBe(affection);
      }
    });

    it("handles extreme intensity values", () => {
      for (const intensity of [0.0, 0.05, 0.5, 0.99, 1.0]) {
        const state: EmotionalState = {
          mood: "happy",
          intensity,
          lastChangeMs: 1000,
          triggers: [],
          affection: 50,
        };
        saveMoodState(tmpDir, state);
        const loaded = loadMoodState(tmpDir);
        expect(loaded!.intensity).toBeCloseTo(intensity, 5);
      }
    });
  });
});

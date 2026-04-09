/**
 * Mood state persistence.
 *
 * Saves and loads the emotional state to/from a JSON file
 * in the workspace's .arona/ directory.
 */

import fs from "node:fs";
import path from "node:path";
import type { EmotionalState } from "./emotional-state.js";
import { createInitialState } from "./emotional-state.js";

const STATE_DIR = ".arona";
const STATE_FILE = "mood-state.json";

function resolveStatePath(workspaceDir: string): string {
  return path.join(workspaceDir, STATE_DIR, STATE_FILE);
}

/**
 * Save emotional state to disk.
 * Creates .arona/ directory if it doesn't exist.
 */
export function saveMoodState(workspaceDir: string, state: EmotionalState): void {
  const statePath = resolveStatePath(workspaceDir);
  const dir = path.dirname(statePath);

  try {
    fs.mkdirSync(dir, { recursive: true });
    const payload = JSON.stringify(state, null, 2) + "\n";
    const tmpPath = `${statePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, payload, "utf-8");
    fs.renameSync(tmpPath, statePath);
  } catch {
    // Best-effort: don't crash if we can't persist mood state
  }
}

/**
 * Load emotional state from disk.
 * Returns null if file doesn't exist or is invalid, letting caller
 * fall back to createInitialState().
 */
export function loadMoodState(workspaceDir: string): EmotionalState | null {
  const statePath = resolveStatePath(workspaceDir);

  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Validate required fields
    if (
      typeof parsed.mood !== "string" ||
      typeof parsed.intensity !== "number" ||
      typeof parsed.lastChangeMs !== "number" ||
      typeof parsed.affection !== "number" ||
      !Array.isArray(parsed.triggers)
    ) {
      return null;
    }

    // New bidirectional fields are optional — old state files are fine without them
    return parsed as unknown as EmotionalState;
  } catch {
    return null;
  }
}

/**
 * Load mood state or create initial state if none exists.
 */
export function loadOrCreateMoodState(workspaceDir: string): EmotionalState {
  return loadMoodState(workspaceDir) ?? createInitialState();
}

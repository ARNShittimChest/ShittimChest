import fs from "node:fs";
import path from "node:path";
import { resolveConfigDir } from "../utils.js";

/**
 * Parse a simple .env file (KEY=VALUE per line, # comments, empty lines).
 * Does NOT handle multiline values or shell-style expansion — matches the
 * subset we actually use in .env files across the project.
 */
function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Load environment variables from dotenv files.
 *
 * Bun automatically loads CWD `.env` on startup, so this function only
 * handles the global fallback: ~/.shittimchest/.env (or SHITTIMCHEST_STATE_DIR/.env).
 * Variables already present in process.env are NOT overridden.
 */
export function loadDotEnv(_opts?: { quiet?: boolean }) {
  // Bun auto-loads CWD .env — we only need the global fallback.
  const globalEnvPath = path.join(resolveConfigDir(process.env), ".env");
  if (!fs.existsSync(globalEnvPath)) {
    return;
  }

  try {
    const content = fs.readFileSync(globalEnvPath, "utf-8");
    const parsed = parseDotEnv(content);
    for (const [key, value] of Object.entries(parsed)) {
      // Do not override existing env vars (same as dotenv { override: false })
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Silently ignore read errors
  }
}

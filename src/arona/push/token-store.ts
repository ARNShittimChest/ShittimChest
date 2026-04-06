/**
 * arona/push/token-store.ts
 * Persists APNs device tokens to a JSON file in ~/.shittimchest/
 * No external deps — pure Node.js fs.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STORE_PATH = path.join(os.homedir(), ".shittimchest", "arona-push-tokens.json");

export type PushToken = {
  token: string;
  platform: "apns";
  bundleId: string;
  registeredAt: string;
};

function loadTokens(): PushToken[] {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as PushToken[];
  } catch {
    // File missing or invalid JSON — start fresh
  }
  return [];
}

function saveTokens(tokens: PushToken[]): void {
  const dir = path.dirname(STORE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(tokens, null, 2), "utf8");
}

export function registerToken(token: string, platform: "apns", bundleId: string): void {
  const tokens = loadTokens();
  // Upsert: remove old entry for same token, add fresh one
  const filtered = tokens.filter((t) => t.token !== token);
  filtered.push({ token, platform, bundleId, registeredAt: new Date().toISOString() });
  saveTokens(filtered);
}

export function getApnsTokens(): PushToken[] {
  return loadTokens().filter((t) => t.platform === "apns");
}

export function removeToken(token: string): void {
  const tokens = loadTokens().filter((t) => t.token !== token);
  saveTokens(tokens);
}

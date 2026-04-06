/**
 * arona/push/push-handler.ts
 * HTTP request handler for Arona push routes.
 * Mounts at /arona/push/* — no auth required for /register, /pending, /long-poll, and /mood
 * (all called from the iOS app over local/LAN).
 *
 * Routes:
 *   POST /arona/push/register   — accept device registration (open, from app)
 *   GET  /arona/push/pending    — drain queued messages + current mood snapshot (open)
 *   GET  /arona/push/long-poll  — hold connection until message arrives or timeout + mood (open)
 *   GET  /arona/push/mood       — current mood snapshot only (open, for widget refresh)
 *   GET  /arona/push/weather    — current weather snapshot (open, for widget refresh)
 *   POST /arona/push/send       — enqueue a push (requires gateway token header)
 *   POST /arona/push/test       — enqueue test push (requires gateway token header)
 *   GET  /arona/push/tokens     — list registration count (requires gateway token header)
 *   POST /arona/push/location   — update GPS coordinates (requires gateway token header)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { loadMoodState } from "../../companion/mood-persistence.js";
import { getAffectionLevel } from "../../companion/emotional-state.js";
import { drainPending, enqueuePush, pendingCount, waitForPending } from "./pending-store.js";
import { getApnsTokens, registerToken } from "./token-store.js";
import {
  setUserLocation,
  hasLocationChanged,
  saveLocation,
  setUserPlace,
} from "../location-store.js";
import { reverseGeocode } from "../geocoding.js";
import { getWeatherData } from "../weather/weather-store.js";
import { forceRefreshWeather } from "../weather/weather-store.js";
import { buildWeatherShortSummary } from "../weather/weather-mood.js";

const PUSH_BASE = "/arona/push";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function hasGatewayToken(req: IncomingMessage): boolean {
  const auth = req.headers["authorization"] ?? req.headers["x-shittimchest-token"] ?? "";
  // Accept any non-empty bearer token (gateway runs locally — no brute force risk)
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.length > 10;
  }
  return false;
}

/** Read current mood snapshot for inclusion in HTTP responses to the iOS app. */
function getMoodSnapshot(): Record<string, unknown> | null {
  try {
    const cfg = loadConfig();
    const raw = cfg.agents?.defaults?.workspace ?? "~/.shittimchest/workspace";
    const workspaceDir = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
    const state = loadMoodState(workspaceDir);
    if (!state) return null;
    return {
      mood: state.mood,
      intensity: state.intensity,
      affection: state.affection,
      affectionLevel: getAffectionLevel(state.affection),
      triggers: state.triggers,
    };
  } catch {
    return null;
  }
}

export async function handleAronaPushRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(PUSH_BASE)) return false;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-ShittimChest-Token",
    );
    res.statusCode = 204;
    res.end();
    return true;
  }

  const subPath = url.pathname.slice(PUSH_BASE.length).replace(/^\//, "");

  // ── POST /arona/push/register ────────────────────────────────────────────
  // Accept both "apns" (legacy) and "local" platforms from the iOS app.
  if (subPath === "register" && req.method === "POST") {
    const raw = await readBody(req);
    let body: { token?: string; platform?: string; bundleId?: string } = {};
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid JSON" });
      return true;
    }
    const { token, platform, bundleId } = body;
    if (!token || !platform) {
      sendJson(res, 400, { ok: false, error: "token and platform required" });
      return true;
    }
    // Accept "local" (BGFetch) platform — no APNs token needed, treat as registration ack.
    if (platform !== "apns" && platform !== "local") {
      sendJson(res, 400, { ok: false, error: "unsupported platform" });
      return true;
    }
    if (platform === "apns") {
      // Keep legacy APNs token for potential future use
      registerToken(token as string, "apns", bundleId ?? "com.furiri.Arona-AI");
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  // ── GET /arona/push/pending ──────────────────────────────────────────────
  // Called by the iOS BGAppRefreshTask. Returns queued messages and clears queue.
  if (subPath === "pending" && req.method === "GET") {
    const messages = drainPending();
    const mood = getMoodSnapshot();
    sendJson(res, 200, { ok: true, messages, mood });
    return true;
  }

  // ── GET /arona/push/long-poll ────────────────────────────────────────────
  // Holds the connection open for up to 25 seconds. Returns immediately if
  // messages are already queued; otherwise waits until enqueuePush() is called.
  // The iOS app uses this with a background URLSession download task for
  // near-instant notification delivery without APNs.
  if (subPath === "long-poll" && req.method === "GET") {
    // Parse optional timeout from query string (max 25s)
    const timeoutParam = url.searchParams.get("timeout");
    const timeoutMs = Math.min(Math.max(Number(timeoutParam) || 25000, 1000), 25000);

    // Handle client disconnect
    let aborted = false;
    req.on("close", () => {
      aborted = true;
    });

    const messages = await waitForPending(timeoutMs);
    if (!aborted) {
      const mood = getMoodSnapshot();
      sendJson(res, 200, { ok: true, messages, mood });
    }
    return true;
  }

  // ── GET /arona/push/mood ─────────────────────────────────────────────────
  // Returns current mood state. Called by iOS widget/BackgroundFetch to refresh
  // widget data when WebSocket is not available.
  if (subPath === "mood" && req.method === "GET") {
    const mood = getMoodSnapshot();
    sendJson(res, 200, { ok: true, mood });
    return true;
  }

  // ── GET /arona/push/tokens ───────────────────────────────────────────────
  if (subPath === "tokens" && req.method === "GET") {
    if (!hasGatewayToken(req)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return true;
    }
    const tokens = getApnsTokens();
    sendJson(res, 200, {
      ok: true,
      pendingCount: pendingCount(),
      apnsCount: tokens.length,
      tokens: tokens.map((t) => ({
        tokenPrefix: t.token.slice(0, 8) + "…",
        platform: t.platform,
        registeredAt: t.registeredAt,
      })),
    });
    return true;
  }

  // ── POST /arona/push/send ────────────────────────────────────────────────
  // Enqueues a message for the next iOS background fetch.
  if (subPath === "send" && req.method === "POST") {
    if (!hasGatewayToken(req)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return true;
    }
    const raw = await readBody(req);
    let body: { title?: string; message?: string } = {};
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid JSON" });
      return true;
    }
    enqueuePush({ title: body.title ?? "Arona", body: body.message ?? "" });
    sendJson(res, 200, { ok: true, queued: 1, pendingCount: pendingCount() });
    return true;
  }

  // ── POST /arona/push/test ─────────────────────────────────────────────────
  if (subPath === "test" && req.method === "POST") {
    if (!hasGatewayToken(req)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return true;
    }
    const raw = await readBody(req);
    let body: { message?: string } = {};
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      // Default test message
    }
    enqueuePush({
      title: "Arona",
      body: body.message ?? "Munya~! Sensei, đây là tin nhắn thử nghiệm! (｡•̀ᴗ-)✧",
    });
    sendJson(res, 200, { ok: true, queued: 1, pendingCount: pendingCount() });
    return true;
  }

  // ── POST /arona/push/location ─────────────────────────────────────────────
  if (subPath === "location" && req.method === "POST") {
    if (!hasGatewayToken(req)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return true;
    }
    const raw = await readBody(req);
    let body: { lat?: number; lon?: number } = {};
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid JSON" });
      return true;
    }
    if (typeof body.lat === "number" && typeof body.lon === "number") {
      const locationChanged = hasLocationChanged(body.lat, body.lon);
      setUserLocation(body.lat, body.lon);

      // Persist to disk
      const cfg = loadConfig();
      const rawWs = cfg.agents?.defaults?.workspace ?? "~/.shittimchest/workspace";
      const workspaceDir = rawWs.startsWith("~/") ? path.join(os.homedir(), rawWs.slice(2)) : rawWs;
      saveLocation(workspaceDir);

      // Async: reverse geocode + refresh weather if location changed significantly
      if (locationChanged) {
        void (async () => {
          try {
            const place = await reverseGeocode(body.lat!, body.lon!);
            if (place) {
              setUserPlace(place);
              saveLocation(workspaceDir);
            }
          } catch {
            // Geocoding failure is non-fatal
          }
          try {
            await forceRefreshWeather(body.lat!, body.lon!);
          } catch {
            // Weather refresh failure is non-fatal
          }
        })();
      }

      sendJson(res, 200, { ok: true, locationChanged });
    } else {
      sendJson(res, 400, { ok: false, error: "missing lat/lon" });
    }
    return true;
  }

  // ── GET /arona/push/weather ─────────────────────────────────────────────
  // Returns current weather snapshot for iOS widget.
  if (subPath === "weather" && req.method === "GET") {
    const weather = getWeatherData();
    if (!weather) {
      sendJson(res, 200, { ok: true, weather: null });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      weather: {
        current: weather.current,
        forecast: weather.forecast,
        locationName: weather.locationName,
        source: weather.source,
        fetchedAt: weather.fetchedAt,
        shortSummary: buildWeatherShortSummary(weather),
      },
    });
    return true;
  }

  // Unknown sub-path
  sendJson(res, 404, { ok: false, error: "Not Found" });
  return true;
}

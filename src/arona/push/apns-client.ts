/**
 * arona/push/apns-client.ts
 * Sends APNs HTTP/2 push notifications using node-fetch + JWT.
 *
 * Credentials from env vars:
 *   ARONA_APNS_KEY_PATH   — path to .p8 private key file
 *   ARONA_APNS_KEY_ID     — 10-char Key ID from Apple Developer portal
 *   ARONA_APNS_TEAM_ID    — 10-char Team ID
 *   ARONA_APNS_BUNDLE_ID  — com.furiri.Arona-AI (default)
 *   ARONA_APNS_PRODUCTION — "true" for production APNs, else sandbox
 */

import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";

const DEFAULT_BUNDLE_ID = "com.furiri.Arona-AI";

function getEnv(key: string): string | undefined {
  return process.env[key];
}

// ── JWT (ES256) ──────────────────────────────────────────────────────────────

let cachedJwt: { token: string; issuedAt: number } | null = null;

function makeJwt(keyPath: string, keyId: string, teamId: string): string {
  const now = Math.floor(Date.now() / 1000);
  // Reuse JWT for up to 55 minutes (Apple allows max 60)
  if (cachedJwt && now - cachedJwt.issuedAt < 55 * 60) {
    return cachedJwt.token;
  }

  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString("base64url");
  const toSign = `${header}.${payload}`;
  const key = fs.readFileSync(keyPath, "utf8");
  const sign = crypto.createSign("SHA256");
  sign.update(toSign);
  const sig = sign.sign({ key, format: "pem", dsaEncoding: "ieee-p1363" }).toString("base64url");

  const token = `${toSign}.${sig}`;
  cachedJwt = { token, issuedAt: now };
  return token;
}

// ── Send one push notification ────────────────────────────────────────────────

export type ApnsPushPayload = {
  title: string;
  body: string;
  sound?: string;
  badge?: number;
  data?: Record<string, unknown>;
};

export async function sendApnsPush(
  deviceToken: string,
  payload: ApnsPushPayload,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const keyPath = getEnv("ARONA_APNS_KEY_PATH");
  const keyId = getEnv("ARONA_APNS_KEY_ID");
  const teamId = getEnv("ARONA_APNS_TEAM_ID");
  const bundleId = getEnv("ARONA_APNS_BUNDLE_ID") ?? DEFAULT_BUNDLE_ID;
  const isProd = getEnv("ARONA_APNS_PRODUCTION") === "true";

  if (!keyPath || !keyId || !teamId) {
    return {
      ok: false,
      error:
        "Missing APNs credentials. Set ARONA_APNS_KEY_PATH, ARONA_APNS_KEY_ID, ARONA_APNS_TEAM_ID.",
    };
  }

  const jwt = makeJwt(keyPath, keyId, teamId);
  const host = isProd ? "api.push.apple.com" : "api.sandbox.push.apple.com";
  const path = `/3/device/${deviceToken}`;

  const apsPayload = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: payload.sound ?? "default",
      badge: payload.badge,
    },
    ...payload.data,
  };
  const body = JSON.stringify(apsPayload);

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: host,
        port: 443,
        path,
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": bundleId,
          "apns-push-type": "alert",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (status === 200) {
            resolve({ ok: true, status });
          } else {
            const text = Buffer.concat(chunks).toString("utf8");
            let reason = text;
            try {
              const parsed = JSON.parse(text) as { reason?: string };
              reason = parsed.reason ?? text;
            } catch {
              // use raw text
            }
            resolve({ ok: false, status, error: reason });
          }
        });
      },
    );
    req.on("error", (err) => resolve({ ok: false, error: String(err) }));
    req.write(body);
    req.end();
  });
}

// ── Broadcast to all registered tokens ───────────────────────────────────────

import { getApnsTokens, removeToken } from "./token-store.js";

export async function broadcastPush(payload: ApnsPushPayload): Promise<{
  sent: number;
  failed: number;
  errors: string[];
}> {
  const tokens = getApnsTokens();
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  await Promise.all(
    tokens.map(async (t) => {
      const result = await sendApnsPush(t.token, payload);
      if (result.ok) {
        sent++;
      } else {
        failed++;
        errors.push(`${t.token.slice(0, 8)}…: ${result.error ?? result.status}`);
        // Remove tokens that are definitively invalid
        if (result.status === 410 || result.error === "BadDeviceToken") {
          removeToken(t.token);
        }
      }
    }),
  );

  return { sent, failed, errors };
}

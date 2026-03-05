/**
 * Lightweight HTTP + WebSocket server for web-based onboarding.
 *
 * Started by `shittimchest onboard --web`. Serves a self-contained
 * onboarding SPA and bridges WebSocket messages to the WebPrompter.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { openUrl } from "../commands/onboard-helpers.js";
import type { OnboardOptions } from "../commands/onboard-types.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { runOnboardingWizard } from "./onboarding.js";
import { WizardCancelledError } from "./prompts.js";
import {
  createWebPrompter,
  type WebPromptMessage,
  type WebPromptResponse,
  type WebPrompterTransport,
} from "./web-prompter.js";

// ── Content types ───────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

// ── SPA static file server ──────────────────────────────────────────

function resolveControlUiRoot(): string | null {
  // The built control-ui lives at <project>/ui/dist after `npm run build`
  // in development, assets live at <project>/ui/public and <project>/ui/src
  const candidates = [
    path.resolve(import.meta.dirname ?? __dirname, "../../ui/dist"),
    path.resolve(import.meta.dirname ?? __dirname, "../../ui/public"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return null;
}

function serveStaticFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  uiRoot: string | null,
  onboardingHtml: string,
): boolean {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);

  // Serve the onboarding SPA for the root
  if (pathname === "/" || pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(onboardingHtml);
    return true;
  }

  // Try to serve assets from the ui root (fonts, images, favicon)
  if (uiRoot) {
    // Prevent path traversal
    const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = path.join(uiRoot, safePath);

    if (filePath.startsWith(uiRoot) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] ?? "application/octet-stream";
      const body = fs.readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      });
      res.end(body);
      return true;
    }
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
  return true;
}

// ── WebSocket bridge ────────────────────────────────────────────────

function createWsTransport(ws: WebSocket): WebPrompterTransport {
  const pendingResponses = new Map<string, (value: unknown) => void>();

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(
        typeof raw === "string" ? raw : (raw as Buffer).toString("utf-8"),
      ) as WebPromptResponse;
      if (msg.id) {
        const resolver = pendingResponses.get(msg.id);
        if (resolver) {
          pendingResponses.delete(msg.id);
          resolver(msg.value);
        }
      }
    } catch {
      // ignore malformed messages
    }
  });

  return {
    send: (msg: WebPromptMessage) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    waitForResponse: (id: string): Promise<unknown> => {
      return new Promise<unknown>((resolve, reject) => {
        pendingResponses.set(id, resolve);

        // Clean up if the socket closes
        const onClose = () => {
          pendingResponses.delete(id);
          reject(new WizardCancelledError("browser disconnected"));
        };
        ws.once("close", onClose);

        // Remove close listener once resolved
        const originalResolve = pendingResponses.get(id)!;
        pendingResponses.set(id, (value) => {
          ws.off("close", onClose);
          originalResolve(value);
        });
      });
    },
  };
}

// ── Main entry point ────────────────────────────────────────────────

export interface WebOnboardingServerOptions {
  port?: number;
  opts: OnboardOptions;
  runtime?: RuntimeEnv;
  /** If true, do not open the browser automatically */
  noOpen?: boolean;
}

export async function startWebOnboardingServer(
  serverOpts: WebOnboardingServerOptions,
): Promise<void> {
  const port = serverOpts.port ?? 19821;
  const runtime = serverOpts.runtime ?? defaultRuntime;
  const uiRoot = resolveControlUiRoot();
  const onboardingHtml = buildOnboardingHtml(port);

  const server = http.createServer((req, res) => {
    serveStaticFile(req, res, uiRoot, onboardingHtml);
  });

  const wss = new WebSocketServer({ server });

  let wizardRunning = false;

  return new Promise<void>((resolve, reject) => {
    wss.on("connection", async (ws) => {
      if (wizardRunning) {
        ws.close(4409, "onboarding already in progress");
        return;
      }
      wizardRunning = true;

      const transport = createWsTransport(ws);
      const prompter = createWebPrompter(transport);

      try {
        await runOnboardingWizard(serverOpts.opts, runtime, prompter);
        transport.send({ kind: "complete" });
      } catch (err) {
        if (err instanceof WizardCancelledError) {
          transport.send({ kind: "error", message: "Setup cancelled." });
        } else {
          transport.send({
            kind: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      } finally {
        wizardRunning = false;
        ws.close();
        // Shut down the server after the wizard completes
        setTimeout(() => {
          wss.close();
          server.close();
          resolve();
        }, 1000);
      }
    });

    server.on("error", (err) => {
      reject(err);
    });

    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${port}`;
      runtime.log(`\n  Web onboarding ready: ${url}\n`);

      if (!serverOpts.noOpen) {
        openUrl(url).catch(() => {
          runtime.log(`  Could not open browser automatically. Open the URL above manually.\n`);
        });
      }
    });
  });
}

// ── Inline SPA HTML ─────────────────────────────────────────────────

function buildOnboardingHtml(port: number): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShittimChest — Setup Wizard</title>
  <meta name="color-scheme" content="dark light">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <style>${getOnboardingCSS()}</style>
</head>
<body>
  <div id="wizard-root"></div>
  <script>${getOnboardingJS(port)}</script>
</body>
</html>`;
}

// ── CSS ─────────────────────────────────────────────────────────────

function getOnboardingCSS(): string {
  return /* css */ `
@font-face {
  font-family: 'nexonFont';
  src: url('/assets/NEXONFootballGothicBA1.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
}

:root {
  --bg: #0f172a;
  --bg-accent: #1e293b;
  --bg-elevated: rgba(30, 41, 59, 0.4);
  --bg-hover: rgba(255, 255, 255, 0.08);
  --glass-bg: rgba(15, 23, 42, 0.65);
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
  --glass-blur: blur(16px) saturate(180%);
  --card: rgba(30, 41, 59, 0.5);
  --card-foreground: #f8fafc;
  --card-highlight: rgba(255, 255, 255, 0.05);
  --text: #e4e4e7;
  --text-strong: #fafafa;
  --muted: #71717a;
  --border: #27272a;
  --border-strong: #3f3f46;
  --accent: #ff5c5c;
  --accent-hover: #ff7070;
  --accent-subtle: rgba(255, 92, 92, 0.15);
  --accent-foreground: #fafafa;
  --accent-glow: rgba(255, 92, 92, 0.25);
  --accent-2: #14b8a6;
  --accent-2-subtle: rgba(20, 184, 166, 0.15);
  --ok: #22c55e;
  --ok-subtle: rgba(34, 197, 94, 0.12);
  --warn: #f59e0b;
  --warn-subtle: rgba(245, 158, 11, 0.12);
  --danger: #ef4444;
  --danger-subtle: rgba(239, 68, 68, 0.12);
  --ring: #ff5c5c;
  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--ring);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.03);
  --shadow-lg: 0 12px 28px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.03);
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
  --font-body: 'nexonFont', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --duration-fast: 120ms;
  --duration-normal: 200ms;
  --duration-slow: 350ms;
  color-scheme: dark;
}

* { box-sizing: border-box; }

html, body {
  height: 100%;
  margin: 0;
  font: 400 14px/1.55 var(--font-body);
  font-style: italic;
  font-weight: 300;
  letter-spacing: -0.02em;
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

body::before {
  content: "";
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background-image: url('/assets/Popup_Img_Deco_1.png');
  background-size: cover;
  background-position: center;
  filter: blur(8px);
  z-index: -1;
  transform: scale(1.1);
}

/* ─── Wizard container ───────────────────────────────────── */
#wizard-root {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
}

.wizard {
  width: 100%;
  max-width: 640px;
  animation: wizard-enter 0.5s var(--ease-out);
}

@keyframes wizard-enter {
  from { opacity: 0; transform: translateY(20px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* ─── Step card ──────────────────────────────────────────── */
.wizard-step {
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-radius: var(--radius-xl);
  padding: 32px;
  box-shadow: var(--glass-shadow), inset 0 1px 0 var(--card-highlight);
  animation: step-in 0.35s var(--ease-out);
}

@keyframes step-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

.wizard-step__title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--text-strong);
  margin: 0 0 8px;
  line-height: 1.2;
}

.wizard-step__subtitle {
  color: var(--muted);
  font-size: 14px;
  margin: 0 0 24px;
  line-height: 1.5;
}

/* ─── Note block ─────────────────────────────────────────── */
.wizard-note {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: inset 0 1px 0 var(--card-highlight);
  animation: step-in 0.3s var(--ease-out);
}

.wizard-note__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--accent);
  margin: 0 0 10px;
  letter-spacing: -0.01em;
}

.wizard-note__body {
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  color: var(--text);
}

/* ─── Select / Radio options ─────────────────────────────── */
.wizard-options {
  display: grid;
  gap: 8px;
  margin-bottom: 24px;
}

.wizard-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  cursor: pointer;
  transition: border-color var(--duration-fast) ease,
              background var(--duration-fast) ease,
              transform var(--duration-fast) ease,
              box-shadow var(--duration-fast) ease;
  box-shadow: inset 0 1px 0 var(--card-highlight);
}

.wizard-option:hover {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(30, 41, 59, 0.7);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm), inset 0 1px 0 var(--card-highlight);
}

.wizard-option.selected {
  border-color: var(--accent);
  background: var(--accent-subtle);
  box-shadow: 0 0 0 1px var(--accent), inset 0 1px 0 var(--card-highlight);
}

.wizard-option__radio {
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  border: 2px solid var(--border-strong);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color var(--duration-fast) ease;
}

.wizard-option.selected .wizard-option__radio {
  border-color: var(--accent);
}

.wizard-option.selected .wizard-option__radio::after {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--accent);
}

.wizard-option__checkbox {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 2px solid var(--border-strong);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color var(--duration-fast) ease,
              background var(--duration-fast) ease;
}

.wizard-option.selected .wizard-option__checkbox {
  border-color: var(--accent);
  background: var(--accent);
}

.wizard-option.selected .wizard-option__checkbox::after {
  content: "✓";
  color: white;
  font-size: 12px;
  font-weight: 700;
}

.wizard-option__content {
  flex: 1;
  min-width: 0;
}

.wizard-option__label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
  letter-spacing: -0.01em;
}

.wizard-option__hint {
  font-size: 12px;
  color: var(--muted);
  margin-top: 2px;
}

/* ─── Text input ─────────────────────────────────────────── */
.wizard-input {
  width: 100%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  font: inherit;
  color: var(--text-strong);
  outline: none;
  box-shadow: inset 0 1px 0 var(--card-highlight);
  transition: border-color var(--duration-fast) ease,
              box-shadow var(--duration-fast) ease;
  margin-bottom: 24px;
}

.wizard-input:focus {
  border-color: var(--ring);
  box-shadow: var(--focus-ring);
}

.wizard-input::placeholder {
  color: var(--muted);
}

.wizard-input-error {
  color: var(--danger);
  font-size: 12px;
  margin: -20px 0 16px;
}

/* ─── Buttons ────────────────────────────────────────────── */
.wizard-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 8px;
}

.wizard-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  background: transparent;
  padding: 10px 20px;
  font-size: 14px;
  font-family: 'nexonFont', var(--font-body);
  font-weight: 700;
  letter-spacing: -0.01em;
  cursor: pointer;
  z-index: 1;
  color: var(--text-strong);
}

.wizard-btn::before {
  content: "";
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-md);
  transform: skewX(-10deg);
  z-index: -1;
  transition: border-color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}

.wizard-btn:hover::before {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.3);
  transform: skewX(-10deg) translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.wizard-btn.primary {
  color: #452319;
}

.wizard-btn.primary::before {
  border-color: transparent;
  background: #f0e76e;
  box-shadow: 0 3px 3px rgba(0, 0, 0, 0.2);
}

.wizard-btn.primary::after {
  content: "";
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background-image: url('/assets/common_btn_normal_y_s_pt.png');
  background-size: 100% 100%;
  transform: skewX(-10deg);
  opacity: 0.6;
  z-index: -1;
  pointer-events: none;
}

.wizard-btn.primary:hover::before {
  background: #f6ef86;
  transform: skewX(-10deg) translateY(-2px);
  box-shadow: 0 5px 5px rgba(0, 0, 0, 0.2);
}

.wizard-btn.danger {
  color: #452319;
}

.wizard-btn.danger::before {
  border-color: transparent;
  background: rgb(161, 225, 251);
  box-shadow: 0 3px 3px rgba(0, 0, 0, 0.2);
}

.wizard-btn.danger::after {
  content: "";
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background-image: url('/assets/common_btn_normal_b_s_pt.png');
  background-size: 100% 100%;
  transform: skewX(-10deg);
  opacity: 0.6;
  z-index: -1;
  pointer-events: none;
}

.wizard-btn.danger:hover::before {
  background: rgb(181, 235, 255);
  transform: skewX(-10deg) translateY(-2px);
  box-shadow: 0 5px 5px rgba(0, 0, 0, 0.2);
}

/* ─── Confirm buttons ────────────────────────────────────── */
.wizard-confirm-buttons {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

/* ─── Progress ───────────────────────────────────────────── */
.wizard-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
}

.wizard-progress__spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.wizard-progress__label {
  color: var(--text);
  font-size: 14px;
}

/* ─── Complete / Error ───────────────────────────────────── */
.wizard-complete {
  text-align: center;
  padding: 40px 20px;
}

.wizard-complete__icon {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  background: var(--ok-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
  font-size: 28px;
  animation: scale-pop 0.5s var(--ease-spring);
}

@keyframes scale-pop {
  from { opacity: 0; transform: scale(0.5); }
  to   { opacity: 1; transform: scale(1); }
}

.wizard-complete__title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-strong);
  margin: 0 0 8px;
}

.wizard-complete__sub {
  color: var(--muted);
  font-size: 14px;
}

.wizard-error {
  text-align: center;
  padding: 40px 20px;
}

.wizard-error__icon {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  background: var(--danger-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
  font-size: 28px;
}

.wizard-error__title {
  font-size: 20px;
  font-weight: 700;
  color: var(--danger);
  margin: 0 0 8px;
}

.wizard-error__message {
  color: var(--muted);
  font-size: 14px;
  white-space: pre-wrap;
}

/* ─── Search input for multiselect ───────────────────────── */
.wizard-search {
  width: 100%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  font: inherit;
  color: var(--text-strong);
  outline: none;
  margin-bottom: 12px;
  box-shadow: inset 0 1px 0 var(--card-highlight);
  transition: border-color var(--duration-fast) ease;
}

.wizard-search:focus {
  border-color: var(--ring);
}

.wizard-search::placeholder {
  color: var(--muted);
}

/* ─── Connecting state ───────────────────────────────────── */
.wizard-connecting {
  text-align: center;
  padding: 60px 20px;
}

.wizard-connecting__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

.wizard-connecting__text {
  color: var(--muted);
  font-size: 14px;
}

/* ─── Step counter ───────────────────────────────────────── */
.wizard-step-counter {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 20px;
}

.wizard-step-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--border);
  transition: background var(--duration-normal) ease,
              box-shadow var(--duration-normal) ease;
}

.wizard-step-dot.active {
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
}

.wizard-step-dot.done {
  background: var(--ok);
}
`;
}

// ── JavaScript ──────────────────────────────────────────────────────

function getOnboardingJS(port: number): string {
  return /* js */ `
(function() {
  "use strict";

  const root = document.getElementById("wizard-root");
  let ws = null;
  let stepCount = 0;

  // ── Pending prompts queue ─────────────────────────────────
  // The server sends prompts sequentially. We track a buffer of
  // note/intro messages and render them together with the next
  // interactive prompt.
  let pendingNotes = [];
  let currentPrompt = null;
  let introTitle = "";

  function connect() {
    render({ state: "connecting" });
    ws = new WebSocket("ws://127.0.0.1:${port}");
    ws.onopen = () => {
      // The wizard starts as soon as the WS connects.
      // Server drives the flow.
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleMessage(msg);
      } catch {}
    };
    ws.onclose = () => {
      // If we haven't shown the complete screen, show an error
      if (!document.querySelector(".wizard-complete")) {
        // Don't overwrite error screens
        if (!document.querySelector(".wizard-error")) {
          render({ state: "disconnected" });
        }
      }
    };
    ws.onerror = () => {};
  }

  function sendResponse(id, value) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id, value }));
    }
  }

  // ── Message handler ───────────────────────────────────────
  function handleMessage(msg) {
    switch (msg.kind) {
      case "intro":
        introTitle = msg.title;
        break;

      case "note":
        pendingNotes.push({ title: msg.title, body: msg.message });
        break;

      case "select":
      case "multiselect":
      case "text":
      case "confirm":
        // Skip internal ack prompts
        if (msg.message === "__ack_intro__" || msg.message === "__ack_note__") {
          sendResponse(msg.id, true);
          return;
        }
        stepCount++;
        currentPrompt = msg;
        renderStep();
        break;

      case "progress-start":
        renderProgress(msg.label, msg.id);
        break;

      case "progress-update":
        updateProgress(msg.message);
        break;

      case "progress-stop":
        // Progress done, next prompt will re-render
        break;

      case "complete":
        renderComplete();
        break;

      case "error":
        renderError(msg.message);
        break;

      case "outro":
        renderComplete(msg.message);
        break;
    }
  }

  // ── Renderers ─────────────────────────────────────────────

  function render(opts) {
    if (opts.state === "connecting") {
      root.innerHTML = \`
        <div class="wizard">
          <div class="wizard-step">
            <div class="wizard-connecting">
              <div class="wizard-connecting__spinner"></div>
              <div class="wizard-connecting__text">Connecting to ShittimChest…</div>
            </div>
          </div>
        </div>
      \`;
    } else if (opts.state === "disconnected") {
      root.innerHTML = \`
        <div class="wizard">
          <div class="wizard-step">
            <div class="wizard-error">
              <div class="wizard-error__icon">⚡</div>
              <div class="wizard-error__title">Disconnected</div>
              <div class="wizard-error__message">Connection to the setup wizard was lost.\\nYou can close this window.</div>
            </div>
          </div>
        </div>
      \`;
    }
  }

  function renderStep() {
    const msg = currentPrompt;
    if (!msg) return;

    const notesHtml = pendingNotes.map(n => \`
      <div class="wizard-note">
        \${n.title ? '<div class="wizard-note__title">' + escapeHtml(n.title) + '</div>' : ''}
        <div class="wizard-note__body">\${escapeHtml(n.body)}</div>
      </div>
    \`).join("");
    pendingNotes = [];

    let contentHtml = "";

    if (msg.kind === "select") {
      contentHtml = renderSelectPrompt(msg);
    } else if (msg.kind === "multiselect") {
      contentHtml = renderMultiselectPrompt(msg);
    } else if (msg.kind === "text") {
      contentHtml = renderTextPrompt(msg);
    } else if (msg.kind === "confirm") {
      contentHtml = renderConfirmPrompt(msg);
    }

    // Step dots
    const dotsHtml = Array.from({ length: Math.min(stepCount, 12) }, (_, i) =>
      '<div class="wizard-step-dot ' + (i < stepCount - 1 ? 'done' : i === stepCount - 1 ? 'active' : '') + '"></div>'
    ).join("");

    root.innerHTML = \`
      <div class="wizard">
        <div class="wizard-step">
          <div class="wizard-step-counter">\${dotsHtml}</div>
          \${introTitle ? '<div class="wizard-step__title">' + escapeHtml(introTitle) + '</div>' : ''}
          \${notesHtml}
          \${msg.kind !== "__ack__" ? '<div class="wizard-step__subtitle">' + escapeHtml(msg.message) + '</div>' : ''}
          \${contentHtml}
        </div>
      </div>
    \`;

    // Attach event listeners
    if (msg.kind === "select") {
      attachSelectListeners(msg);
    } else if (msg.kind === "multiselect") {
      attachMultiselectListeners(msg);
    } else if (msg.kind === "text") {
      attachTextListeners(msg);
    } else if (msg.kind === "confirm") {
      attachConfirmListeners(msg);
    }
  }

  // ── Select ────────────────────────────────────────────────
  function renderSelectPrompt(msg) {
    return \`
      <div class="wizard-options" id="options-\${msg.id}">
        \${msg.options.map((opt, i) => \`
          <div class="wizard-option\${JSON.stringify(opt.value) === JSON.stringify(msg.initialValue) ? ' selected' : ''}" data-index="\${i}">
            <div class="wizard-option__radio"></div>
            <div class="wizard-option__content">
              <div class="wizard-option__label">\${escapeHtml(opt.label)}</div>
              \${opt.hint ? '<div class="wizard-option__hint">' + escapeHtml(opt.hint) + '</div>' : ''}
            </div>
          </div>
        \`).join("")}
      </div>
      <div class="wizard-actions">
        <button class="wizard-btn primary" id="submit-\${msg.id}">Continue</button>
      </div>
    \`;
  }

  function attachSelectListeners(msg) {
    const container = document.getElementById("options-" + msg.id);
    const submitBtn = document.getElementById("submit-" + msg.id);
    let selectedIndex = msg.options.findIndex(o => JSON.stringify(o.value) === JSON.stringify(msg.initialValue));
    if (selectedIndex < 0) selectedIndex = 0;

    // Apply initial selection
    updateSelection(container, selectedIndex);

    container.addEventListener("click", (e) => {
      const opt = e.target.closest(".wizard-option");
      if (!opt) return;
      selectedIndex = parseInt(opt.dataset.index, 10);
      updateSelection(container, selectedIndex);
    });

    submitBtn.addEventListener("click", () => {
      submitBtn.disabled = true;
      sendResponse(msg.id, msg.options[selectedIndex].value);
    });
  }

  function updateSelection(container, idx) {
    container.querySelectorAll(".wizard-option").forEach((el, i) => {
      el.classList.toggle("selected", i === idx);
    });
  }

  // ── Multiselect ───────────────────────────────────────────
  function renderMultiselectPrompt(msg) {
    const searchHtml = msg.searchable
      ? '<input class="wizard-search" placeholder="Search…" id="search-' + msg.id + '">'
      : '';

    return \`
      \${searchHtml}
      <div class="wizard-options" id="options-\${msg.id}">
        \${msg.options.map((opt, i) => {
          const checked = (msg.initialValues || []).some(v => JSON.stringify(v) === JSON.stringify(opt.value));
          return \`
            <div class="wizard-option\${checked ? ' selected' : ''}" data-index="\${i}">
              <div class="wizard-option__checkbox"></div>
              <div class="wizard-option__content">
                <div class="wizard-option__label">\${escapeHtml(opt.label)}</div>
                \${opt.hint ? '<div class="wizard-option__hint">' + escapeHtml(opt.hint) + '</div>' : ''}
              </div>
            </div>
          \`;
        }).join("")}
      </div>
      <div class="wizard-actions">
        <button class="wizard-btn primary" id="submit-\${msg.id}">Continue</button>
      </div>
    \`;
  }

  function attachMultiselectListeners(msg) {
    const container = document.getElementById("options-" + msg.id);
    const submitBtn = document.getElementById("submit-" + msg.id);
    const searchInput = document.getElementById("search-" + msg.id);
    let selected = new Set((msg.initialValues || []).map(v => JSON.stringify(v)));

    container.addEventListener("click", (e) => {
      const opt = e.target.closest(".wizard-option");
      if (!opt) return;
      const idx = parseInt(opt.dataset.index, 10);
      const key = JSON.stringify(msg.options[idx].value);
      if (selected.has(key)) {
        selected.delete(key);
        opt.classList.remove("selected");
      } else {
        selected.add(key);
        opt.classList.add("selected");
      }
    });

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const q = searchInput.value.toLowerCase().trim();
        container.querySelectorAll(".wizard-option").forEach((el, i) => {
          const opt = msg.options[i];
          const text = (opt.label + " " + (opt.hint || "")).toLowerCase();
          el.style.display = !q || text.includes(q) ? "" : "none";
        });
      });
    }

    submitBtn.addEventListener("click", () => {
      submitBtn.disabled = true;
      const values = msg.options
        .filter(o => selected.has(JSON.stringify(o.value)))
        .map(o => o.value);
      sendResponse(msg.id, values);
    });
  }

  // ── Text ──────────────────────────────────────────────────
  function renderTextPrompt(msg) {
    return \`
      <input class="wizard-input" id="input-\${msg.id}"
             type="text"
             value="\${escapeAttr(msg.initialValue || '')}"
             placeholder="\${escapeAttr(msg.placeholder || '')}">
      <div class="wizard-input-error" id="error-\${msg.id}"></div>
      <div class="wizard-actions">
        <button class="wizard-btn primary" id="submit-\${msg.id}">Continue</button>
      </div>
    \`;
  }

  function attachTextListeners(msg) {
    const input = document.getElementById("input-" + msg.id);
    const submitBtn = document.getElementById("submit-" + msg.id);

    input.focus();

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        submitBtn.click();
      }
    });

    submitBtn.addEventListener("click", () => {
      submitBtn.disabled = true;
      sendResponse(msg.id, input.value);
    });
  }

  // ── Confirm ───────────────────────────────────────────────
  function renderConfirmPrompt(msg) {
    return \`
      <div class="wizard-confirm-buttons">
        <button class="wizard-btn primary" id="yes-\${msg.id}">Yes</button>
        <button class="wizard-btn danger" id="no-\${msg.id}">No</button>
      </div>
    \`;
  }

  function attachConfirmListeners(msg) {
    const yesBtn = document.getElementById("yes-" + msg.id);
    const noBtn = document.getElementById("no-" + msg.id);

    yesBtn.addEventListener("click", () => {
      yesBtn.disabled = true;
      noBtn.disabled = true;
      sendResponse(msg.id, true);
    });

    noBtn.addEventListener("click", () => {
      yesBtn.disabled = true;
      noBtn.disabled = true;
      sendResponse(msg.id, false);
    });
  }

  // ── Progress ──────────────────────────────────────────────
  function renderProgress(label) {
    // Show progress inline below current step
    const existing = document.querySelector(".wizard-progress");
    if (existing) {
      existing.querySelector(".wizard-progress__label").textContent = label;
      return;
    }

    const step = document.querySelector(".wizard-step");
    if (step) {
      const div = document.createElement("div");
      div.className = "wizard-progress";
      div.innerHTML = \`
        <div class="wizard-progress__spinner"></div>
        <div class="wizard-progress__label">\${escapeHtml(label)}</div>
      \`;
      step.appendChild(div);
    }
  }

  function updateProgress(message) {
    const label = document.querySelector(".wizard-progress__label");
    if (label) label.textContent = message;
  }

  // ── Complete ──────────────────────────────────────────────
  function renderComplete(message) {
    root.innerHTML = \`
      <div class="wizard">
        <div class="wizard-step">
          <div class="wizard-complete">
            <div class="wizard-complete__icon">✓</div>
            <div class="wizard-complete__title">Setup Complete!</div>
            <div class="wizard-complete__sub">\${escapeHtml(message || 'ShittimChest is ready to use. You can close this window.')}</div>
          </div>
        </div>
      </div>
    \`;
  }

  // ── Error ─────────────────────────────────────────────────
  function renderError(message) {
    root.innerHTML = \`
      <div class="wizard">
        <div class="wizard-step">
          <div class="wizard-error">
            <div class="wizard-error__icon">✕</div>
            <div class="wizard-error__title">Setup Error</div>
            <div class="wizard-error__message">\${escapeHtml(message)}</div>
          </div>
        </div>
      </div>
    \`;
  }

  // ── Utilities ─────────────────────────────────────────────
  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    if (typeof str !== "string") return "";
    return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ── Boot ──────────────────────────────────────────────────
  connect();
})();
`;
}

/**
 * Lightweight HTTP + WebSocket server for web-based onboarding.
 *
 * Started by `shittimchest onboard` (default). Serves the pre-built
 * onboarding SPA from `dist/onboard-ui/` and bridges WebSocket messages
 * to the WebPrompter.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { openUrl } from "../commands/onboard-helpers.js";
import type { OnboardOptions } from "../commands/onboard-types.js";
import { runCommandWithTimeout } from "../process/exec.js";
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

// ── Resolve built SPA directory ─────────────────────────────────────

function resolveOnboardUiRoot(): string | null {
  const base = import.meta.dirname ?? __dirname;
  const candidates = [
    // When running from dist/ (bundled): dist/onboard-ui is a sibling
    path.resolve(base, "onboard-ui"),
    // When running from src/wizard/ (dev): go up to repo root, then dist/onboard-ui
    path.resolve(base, "../../dist/onboard-ui"),
    // Fallback: ui-onboard/dist (dev build output)
    path.resolve(base, "../../ui-onboard/dist"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) {
      return dir;
    }
  }
  return null;
}

// ── SPA static file server ──────────────────────────────────────────

function serveStaticFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  uiRoot: string,
  port: number,
): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);

  // For the root or unknown paths, serve index.html (SPA fallthrough)
  if (pathname === "/" || pathname === "/index.html") {
    let html = fs.readFileSync(path.join(uiRoot, "index.html"), "utf-8");
    // Inject the WS port as a data attribute
    html = html.replace('id="wizard-root"', `id="wizard-root" data-ws-port="${port}"`);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // Serve static assets
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
    return;
  }

  // SPA fallthrough: serve index.html for unknown routes
  let html = fs.readFileSync(path.join(uiRoot, "index.html"), "utf-8");
  html = html.replace('id="wizard-root"', `id="wizard-root" data-ws-port="${port}"`);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
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

        const onClose = () => {
          pendingResponses.delete(id);
          reject(new WizardCancelledError("browser disconnected"));
        };
        ws.once("close", onClose);

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
  let uiRoot = resolveOnboardUiRoot();

  if (!uiRoot) {
    // Attempt auto-build like control-ui does
    const base = import.meta.dirname ?? __dirname;
    // Try both: from dist/ (one up) and from src/wizard/ (two up)
    const possibleRoots = [path.resolve(base, ".."), path.resolve(base, "../..")];
    let buildScript: string | null = null;
    let repoRoot: string | null = null;
    for (const root of possibleRoots) {
      const script = path.join(root, "scripts", "ui-onboard.js");
      if (fs.existsSync(script)) {
        buildScript = script;
        repoRoot = root;
        break;
      }
    }

    if (buildScript && repoRoot) {
      runtime.log("Onboard UI assets missing; building (ui-onboard:build, auto-installs deps)…");
      const build = await runCommandWithTimeout([process.execPath, buildScript, "build"], {
        cwd: repoRoot,
        timeoutMs: 5 * 60_000,
      });
      if (build.code === 0) {
        uiRoot = resolveOnboardUiRoot();
      }
    }

    if (!uiRoot) {
      runtime.log(`\n  ERROR: Onboard UI assets not found. Run 'pnpm ui-onboard:build' first.\n`);
      throw new Error("Onboard UI assets missing. Build ui-onboard first.");
    }
  }

  const server = http.createServer((req, res) => {
    serveStaticFile(req, res, uiRoot, port);
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

#!/usr/bin/env node
/**
 * Build helper for the onboarding UI — mirrors scripts/ui.js.
 * Usage: node scripts/ui-onboard.js <install|build|dev>
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const uiDir = path.join(repoRoot, "ui-onboard");

function which(cmd) {
  const key = process.platform === "win32" ? "Path" : "PATH";
  const paths = (process.env[key] ?? process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  for (const entry of paths) {
    for (const ext of extensions) {
      const candidate = path.join(entry, `${cmd}${ext}`);
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {}
    }
  }
  return null;
}

function runSync(cmd, args, env) {
  const useShell = process.platform === "win32" && /\.(cmd|bat|com)$/i.test(cmd);
  const result = spawnSync(cmd, args, {
    cwd: uiDir,
    stdio: "inherit",
    env: env ?? process.env,
    ...(useShell ? { shell: true } : {}),
  });
  if (result.signal || (result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function depsInstalled() {
  try {
    const require = createRequire(path.join(uiDir, "package.json"));
    require.resolve("vite");
    return true;
  } catch {
    return false;
  }
}

const [action] = process.argv.slice(2);
const runner = which("bun") ?? which("pnpm");
if (!runner) {
  process.stderr.write("Missing bun or pnpm. Install one, then retry.\n");
  process.exit(1);
}

if (action === "install") {
  runSync(runner, ["install"]);
} else if (action === "build" || action === "dev") {
  if (!depsInstalled()) {
    const env = action === "build" ? { ...process.env, NODE_ENV: "production" } : process.env;
    const args = action === "build" ? ["install", "--prod"] : ["install"];
    runSync(runner, args, env);
  }
  runSync(runner, ["run", action]);
} else {
  process.stderr.write("Usage: node scripts/ui-onboard.js <install|build|dev>\n");
  process.exit(2);
}

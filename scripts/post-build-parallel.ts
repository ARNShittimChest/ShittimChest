#!/usr/bin/env bun
/**
 * Run independent post-build steps in parallel for faster builds.
 *
 * After `tsdown` bundles and `build:plugin-sdk:dts` emits declarations,
 * the remaining post-build steps are independent of each other and can
 * run concurrently. This saves ~2-4s on every build.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Task {
  label: string;
  command: string;
  args: string[];
}

const tasks: Task[] = [
  {
    label: "write-plugin-sdk-entry-dts",
    command: "bun",
    args: ["scripts/write-plugin-sdk-entry-dts.ts"],
  },
  {
    label: "canvas-a2ui-copy",
    command: "bun",
    args: ["scripts/canvas-a2ui-copy.ts"],
  },
  {
    label: "copy-hook-metadata",
    command: "bun",
    args: ["scripts/copy-hook-metadata.ts"],
  },
  {
    label: "copy-export-html-templates",
    command: "bun",
    args: ["scripts/copy-export-html-templates.ts"],
  },
  {
    label: "write-build-info",
    command: "bun",
    args: ["scripts/write-build-info.ts"],
  },
  {
    label: "write-cli-compat",
    command: "bun",
    args: ["scripts/write-cli-compat.ts"],
  },
];

function runTask(task: Task): Promise<{ label: string; ok: boolean; durationMs: number }> {
  const start = performance.now();
  return new Promise((resolve) => {
    const child = spawn(task.command, task.args, {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const chunks: Buffer[] = [];
    child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));

    child.on("close", (code) => {
      const durationMs = Math.round(performance.now() - start);
      if (code !== 0) {
        const stderr = Buffer.concat(chunks).toString("utf-8").trim();
        console.error(`[post-build] FAIL ${task.label} (${durationMs}ms)`);
        if (stderr) {
          console.error(stderr);
        }
      }
      resolve({ label: task.label, ok: code === 0, durationMs });
    });

    child.on("error", (err) => {
      const durationMs = Math.round(performance.now() - start);
      console.error(`[post-build] ERROR ${task.label}: ${err.message}`);
      resolve({ label: task.label, ok: false, durationMs });
    });
  });
}

const totalStart = performance.now();
const results = await Promise.all(tasks.map(runTask));
const totalMs = Math.round(performance.now() - totalStart);

const failed = results.filter((r) => !r.ok);
const succeeded = results.filter((r) => r.ok);

if (succeeded.length > 0) {
  const details = succeeded.map((r) => `${r.label} (${r.durationMs}ms)`).join(", ");
  console.log(`[post-build] ${succeeded.length} tasks OK in ${totalMs}ms: ${details}`);
}

if (failed.length > 0) {
  const details = failed.map((r) => r.label).join(", ");
  console.error(`[post-build] ${failed.length} tasks FAILED: ${details}`);
  process.exit(1);
}

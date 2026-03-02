#!/usr/bin/env node
import path from "node:path";
import { createInterface } from "node:readline";

/**
 * Prints selected files as NUL-delimited tokens to stdout.
 *
 * Usage (stdin mode — recommended to avoid arg list limits):
 *   git diff --cached --name-only -z | node filter-staged-files.mjs lint
 *   git diff --cached --name-only -z | node filter-staged-files.mjs format
 *
 * Legacy arg mode still works:
 *   node filter-staged-files.mjs lint -- <files...>
 *
 * Keep this dependency-free: the pre-commit hook runs in many environments.
 */

const mode = process.argv[2];
const rawArgs = process.argv.slice(3);
const argFiles = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

if (mode !== "lint" && mode !== "format") {
  process.stderr.write("usage: filter-staged-files.mjs <lint|format> [-- <files...>]\n");
  process.exit(2);
}

const lintExts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const formatExts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx"]);

const shouldSelect = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (mode === "lint") return lintExts.has(ext);
  return formatExts.has(ext);
};

function emitFile(file) {
  if (file && shouldSelect(file)) {
    process.stdout.write(file);
    process.stdout.write("\0");
  }
}

if (argFiles.length > 0) {
  // Legacy: files passed as command-line arguments
  for (const file of argFiles) emitFile(file);
} else {
  // Stdin mode: read NUL-delimited file list from stdin (avoids arg list limits)
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    const parts = buf.split("\0");
    buf = parts.pop() ?? "";
    for (const part of parts) emitFile(part);
  });
  process.stdin.on("end", () => {
    if (buf) emitFile(buf);
  });
}

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = "e:\\Data\\Arona-CLW";
// Removed 'assets' from exclusion so we can process Chrome extension and other sub-assets
const excludeDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  "vendor",
  "out",
  ".gemini",
  ".vscode",
  ".idea",
  ".pi",
  "Swabble/build",
  "apps/ios/build",
  "apps/shared/ShittimChestKit/build",
  ".svelte-kit",
]);
const excludeExts = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".webm",
  ".zip",
  ".tar",
  ".gz",
  ".sqlite",
  ".db",
  ".pdf",
  ".svg",
  ".bin",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
]);

const thisScript = fileURLToPath(import.meta.url);

let count = 0;

function processDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (excludeDirs.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      processDir(fullPath);
    } else if (entry.isFile()) {
      if (excludeExts.has(path.extname(entry.name).toLowerCase())) continue;
      if (fullPath === thisScript) continue;
      if (
        entry.name === "pnpm-lock.yaml" ||
        entry.name === "package-lock.json" ||
        entry.name === "yarn.lock"
      )
        continue;

      try {
        const content = fs.readFileSync(fullPath, "utf8");
        if (content.includes("\0")) continue;

        if (/ShittimChest|shittimchest|SHITTIMCHEST/.test(content)) {
          const newContent = content
            .replace(/ShittimChest/g, "ShittimChest")
            .replace(/shittimchest/g, "shittimchest")
            .replace(/SHITTIMCHEST/g, "SHITTIMCHEST");
          fs.writeFileSync(fullPath, newContent, "utf8");
          console.log(`Updated: ${fullPath}`);
          count++;
        }
      } catch {}
    }
  }
}

console.log("Starting text replacement...");
processDir(root);
console.log(`Replaced text in ${count} files.`);

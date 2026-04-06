import fs from "fs";
import path from "path";

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

let count = 0;

function renameFilesAndDirs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Process children first (bottom-up approach)
  for (const entry of entries) {
    if (excludeDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      renameFilesAndDirs(fullPath);
    }
  }

  // Re-read entries in this directory after children have been renamed
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (excludeDirs.has(entry.name)) continue;

    if (/openclaw/i.test(entry.name)) {
      const newName = entry.name
        .replace(/OpenClaw/g, "ShittimChest")
        .replace(/openclaw/g, "shittimchest")
        .replace(/OPENCLAW/g, "SHITTIMCHEST");

      if (newName === entry.name) continue;

      const oldPath = path.join(dir, entry.name);
      const newPath = path.join(dir, newName);
      try {
        fs.renameSync(oldPath, newPath);
        console.log(`Renamed: ${oldPath} -> ${newPath}`);
        count++;
      } catch (err) {
        console.warn(`Failed renaming ${oldPath} to ${newPath}: ${err.message}`);
      }
    }
  }
}

console.log("Starting file and directory renaming...");
renameFilesAndDirs(root);
console.log(`Renamed ${count} files and directories.`);

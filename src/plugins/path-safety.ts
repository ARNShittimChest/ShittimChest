import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { isPathInside as isBoundaryPathInside } from "../infra/path-guards.js";

export function isPathInside(baseDir: string, targetPath: string): boolean {
  return isBoundaryPathInside(baseDir, targetPath);
}

export function safeRealpathSync(targetPath: string, cache?: Map<string, string>): string | null {
  const cached = cache?.get(targetPath);
  if (cached) {
    return cached;
  }
  try {
    const resolved = fs.realpathSync(targetPath);
    cache?.set(targetPath, resolved);
    return resolved;
  } catch {
    return null;
  }
}

export function safeStatSync(targetPath: string): fs.Stats | null {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

export function formatPosixMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

// Filesystem types on macOS that do not implement POSIX permission bits
// reliably (e.g. NTFS, FAT, exFAT mounted via macFUSE / Mounty). On these
// filesystems every file reports mode 0777, so the world-writable security
// check would incorrectly block all plugin candidates.
const POSIX_UNRELIABLE_FS_TYPES = new Set([
  "fusefs",
  "macfuse",
  "ntfs",
  "msdos",
  "exfat",
  "fat32",
  "fat16",
  "fat",
  "smbfs",
  "webdav",
  "nfs", // NFS may or may not be reliable; exclude cautiously
]);

// Cache results per absolute path to avoid repeated stat calls.
const posixReliableCache = new Map<string, boolean>();

/**
 * Returns false when the path lives on a filesystem that does not faithfully
 * implement POSIX permission bits (e.g. NTFS mounted via macFUSE on macOS).
 * Always returns true on non-macOS platforms (permissions handled elsewhere).
 */
export function isPosixPermissionReliable(targetPath: string): boolean {
  if (process.platform !== "darwin") {
    return true;
  }

  const cached = posixReliableCache.get(targetPath);
  if (cached !== undefined) {
    return cached;
  }

  try {
    // `stat -f '%T' <path>` prints the filesystem type name on macOS.
    const result = spawnSync("stat", ["-f", "%T", targetPath], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (result.status === 0 && result.stdout) {
      const fsType = result.stdout.trim().toLowerCase();
      const reliable = !POSIX_UNRELIABLE_FS_TYPES.has(fsType);
      posixReliableCache.set(targetPath, reliable);
      return reliable;
    }
  } catch {
    // If we cannot determine the filesystem type, assume permissions are
    // reliable so we don't silently allow world-writable paths on real
    // POSIX filesystems.
  }

  posixReliableCache.set(targetPath, true);
  return true;
}

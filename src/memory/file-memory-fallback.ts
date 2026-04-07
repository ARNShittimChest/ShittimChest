import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("memory");

/**
 * File-based memory fallback for when LanceDB is unavailable.
 *
 * Writes chat turns to daily markdown files under `memory/` in the workspace:
 *   - `MEMORY.md`        — long-term summary (appended with important facts)
 *   - `memory/memory-DD-MM-YYYY.md` — daily conversation logs
 *
 * This is a lightweight, zero-dependency fallback that ensures no conversation
 * data is lost even when the LanceDB native binary is missing (e.g. darwin-x64).
 */
export class FileMemoryFallback {
  private readonly workspaceDir: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  /** Format a date as DD-MM-YYYY for file naming */
  private formatDateStamp(date: Date = new Date()): string {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  /** Format a time as HH:MM:SS for log entries */
  private formatTime(date: Date = new Date()): string {
    return date.toLocaleTimeString("vi-VN", { hour12: false });
  }

  /** Ensure the memory/ directory exists */
  private async ensureMemoryDir(): Promise<string> {
    const memoryDir = path.join(this.workspaceDir, "memory");
    try {
      await fs.mkdir(memoryDir, { recursive: true });
    } catch {}
    return memoryDir;
  }

  /**
   * Record a chat turn to the daily memory file.
   * Appends to `memory/memory-DD-MM-YYYY.md` — creates the file if needed.
   */
  recordChatTurn(role: "user" | "assistant" | "system", text: string): void {
    if (!text.trim()) return;

    // Queue writes to prevent concurrent file access issues
    this.writeQueue = this.writeQueue
      .then(() => this.doRecordChatTurn(role, text))
      .catch((err) => {
        log.debug(`File memory fallback write failed: ${String(err)}`);
      });
  }

  private async doRecordChatTurn(
    role: "user" | "assistant" | "system",
    text: string,
  ): Promise<void> {
    const now = new Date();
    const memoryDir = await this.ensureMemoryDir();
    const filename = `memory-${this.formatDateStamp(now)}.md`;
    const filePath = path.join(memoryDir, filename);
    const time = this.formatTime(now);

    // Format the chat entry
    const roleLabel =
      role === "user" ? "🧑 Sensei" : role === "assistant" ? "🤖 Arona" : "⚙️ System";
    const entry = `\n### [${time}] ${roleLabel}\n${text.trim()}\n`;

    // If file doesn't exist yet, add a header
    let needsHeader = false;
    try {
      await fs.access(filePath);
    } catch {
      needsHeader = true;
    }

    const content = needsHeader
      ? `# 📝 Memory Log — ${now.toLocaleDateString("vi-VN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}\n${entry}`
      : entry;

    await fs.appendFile(filePath, content, "utf-8");
  }

  /**
   * Store a profiler insight to the daily memory file.
   * These are SenseiProfiler observations about the user's personality/preferences.
   */
  async storeProfileInsight(category: string, insight: string): Promise<void> {
    const now = new Date();
    const memoryDir = await this.ensureMemoryDir();
    const filename = `memory-${this.formatDateStamp(now)}.md`;
    const filePath = path.join(memoryDir, filename);

    const entry = `\n### [${this.formatTime(now)}] 📊 Profile Insight [${category}]\n${insight.trim()}\n`;

    let needsHeader = false;
    try {
      await fs.access(filePath);
    } catch {
      needsHeader = true;
    }

    const content = needsHeader
      ? `# 📝 Memory Log — ${now.toLocaleDateString("vi-VN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}\n${entry}`
      : entry;

    await fs.appendFile(filePath, content, "utf-8");
  }

  /**
   * Store a memory reflection summary to MEMORY.md (long-term).
   * Appends the reflection at the end of the file.
   */
  async storeReflection(summary: string): Promise<void> {
    const memoryFile = path.join(this.workspaceDir, "MEMORY.md");

    let needsHeader = false;
    try {
      await fs.access(memoryFile);
    } catch {
      needsHeader = true;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString("vi-VN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const entry = `\n## 🔄 Reflection — ${dateStr}\n${summary.trim()}\n`;

    const content = needsHeader
      ? `# 🧠 Long-term Memory\n\n> Auto-generated memory file. Contains persistent facts and reflections.\n${entry}`
      : entry;

    await fs.appendFile(memoryFile, content, "utf-8");
  }

  /**
   * Check if the file-based fallback has any data for today.
   */
  async hasTodayLog(): Promise<boolean> {
    const memoryDir = path.join(this.workspaceDir, "memory");
    const filename = `memory-${this.formatDateStamp()}.md`;
    const filePath = path.join(memoryDir, filename);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

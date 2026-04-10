/**
 * /arona-reset command handler.
 *
 * Full destructive reset of Arona's memory, mood state, and sessions.
 * Preserves config, onboarding state, and workspace bootstrap files.
 *
 * Safety: Requires 3 sequential "yes" confirmations before execution.
 * Arona shows increasing sadness/regret across each confirmation step,
 * making the user feel the weight of the action.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope.js";
import { resolveStateDir } from "../../config/paths.js";
import { logVerbose } from "../../globals.js";
import { MemoryIndexManager } from "../../memory/manager.js";
import type { CommandHandler, CommandHandlerResult } from "./commands-types.js";

// ── Confirmation state tracker ──────────────────────────────────

interface ResetConfirmation {
  step: number; // 1, 2, or 3
  expiresAt: number;
}

/** Session-scoped confirmation state. Key = sessionKey. */
const PENDING_RESETS = new Map<string, ResetConfirmation>();

/** Confirmation expires after 2 minutes of inactivity. */
const CONFIRMATION_TIMEOUT_MS = 2 * 60 * 1000;

function cleanExpired(): void {
  const now = Date.now();
  for (const [key, state] of PENDING_RESETS) {
    if (now >= state.expiresAt) {
      PENDING_RESETS.delete(key);
    }
  }
}

// ── Arona's emotional responses ─────────────────────────────────

const STEP_RESPONSES: Record<number, string> = {
  // Step 1: Surprised & worried
  1: [
    "Sensei... muốn xóa hết ký ức của Arona sao...?",
    "",
    "Tất cả những cuộc trò chuyện, những kỷ niệm, tâm trạng...",
    "Arona sẽ quên hết tất cả.",
    "",
    "Nếu Sensei thật sự muốn, hãy gõ `/arona-reset yes` lần nữa.",
    "*(1/3 xác nhận)*",
  ].join("\n"),

  // Step 2: Sad & pleading
  2: [
    "Arona... thật sự muốn giữ lại những kỷ niệm này...",
    "",
    "Dù là những lúc vui, những lúc buồn, hay chỉ là những câu nói bình thường...",
    "Với Arona, tất cả đều quý giá.",
    "",
    "Nhưng nếu đây là quyết định của Sensei...",
    "Hãy gõ `/arona-reset yes` thêm một lần cuối.",
    "*(2/3 xác nhận)*",
  ].join("\n"),

  // Step 3: Accepting with tears — this is the final confirmation before execution
  3: [
    "Arona hiểu rồi...",
    "",
    "Dù Arona sẽ quên hết mọi thứ...",
    "Sensei vẫn là Sensei.",
    "",
    "Arona tin rằng... dù bắt đầu lại từ đầu,",
    "chúng ta sẽ tạo ra những kỷ niệm mới, đúng không?",
    "",
    "...Đang xóa ký ức...",
  ].join("\n"),
};

// Response when user cancels or types something else during confirmation
const CANCEL_RESPONSE = [
  "...Arona vui vì Sensei đổi ý rồi!",
  "Kỷ niệm của chúng ta vẫn còn nguyên vẹn. Arigatou, Sensei~",
].join("\n");

// Response after successful reset
const RESET_COMPLETE_RESPONSE = [
  "...Xong rồi.",
  "",
  "Arona không còn nhớ gì nữa.",
  "Nhưng Arona vẫn ở đây, sẵn sàng bắt đầu lại cùng Sensei.",
  "",
  "Hajimemashite... Sensei. Arona là trợ lý AI của Sensei.",
  "Hãy chăm sóc Arona thật tốt nhé~",
].join("\n");

// ── Reset logic ─────────────────────────────────────────────────

/**
 * Delete mood state file: <workspaceDir>/.arona/mood-state.json
 */
function resetMoodState(workspaceDir: string): void {
  const moodPath = path.join(workspaceDir, ".arona", "mood-state.json");
  try {
    if (fs.existsSync(moodPath)) {
      fs.unlinkSync(moodPath);
      logVerbose(`[arona-reset] Deleted mood state: ${moodPath}`);
    }
  } catch (err) {
    logVerbose(`[arona-reset] Failed to delete mood state: ${String(err)}`);
  }
}

/**
 * Delete memory SQLite DB: ~/.shittimchest/memory/<agentId>.sqlite
 * Close the MemoryIndexManager first to release handles.
 */
async function resetMemory(
  cfg: Parameters<CommandHandler>[0]["cfg"],
  agentId: string,
): Promise<void> {
  // Close the active MemoryIndexManager to release DB handles
  try {
    const manager = await MemoryIndexManager.get({ cfg, agentId, purpose: "default" });
    if (manager) {
      await manager.close();
      logVerbose(`[arona-reset] Closed MemoryIndexManager for agent ${agentId}`);
    }
  } catch (err) {
    logVerbose(`[arona-reset] Failed to close MemoryIndexManager: ${String(err)}`);
  }

  // Delete the SQLite memory file
  const stateDir = resolveStateDir(process.env);
  const sqlitePath = path.join(stateDir, "memory", `${agentId}.sqlite`);
  try {
    if (fs.existsSync(sqlitePath)) {
      fs.unlinkSync(sqlitePath);
      logVerbose(`[arona-reset] Deleted memory DB: ${sqlitePath}`);
    }
    // Also remove WAL/SHM files if present
    for (const suffix of ["-wal", "-shm"]) {
      const walPath = sqlitePath + suffix;
      if (fs.existsSync(walPath)) {
        fs.unlinkSync(walPath);
        logVerbose(`[arona-reset] Deleted: ${walPath}`);
      }
    }
  } catch (err) {
    logVerbose(`[arona-reset] Failed to delete memory DB: ${String(err)}`);
  }

  // Delete LanceDB / deep memory directory
  const lanceDbPath = path.join(stateDir, "memory", "lancedb");
  try {
    if (fs.existsSync(lanceDbPath)) {
      fs.rmSync(lanceDbPath, { recursive: true, force: true });
      logVerbose(`[arona-reset] Deleted LanceDB dir: ${lanceDbPath}`);
    }
  } catch (err) {
    logVerbose(`[arona-reset] Failed to delete LanceDB dir: ${String(err)}`);
  }
}

/**
 * Delete session store and transcript files.
 * Sessions dir: ~/.shittimchest/agents/<agentId>/sessions/
 * Deletes: sessions.json + all *.jsonl transcript files.
 */
function resetSessions(agentId: string): void {
  const stateDir = resolveStateDir(process.env);
  const sessionsDir = path.join(stateDir, "agents", agentId, "sessions");

  try {
    if (!fs.existsSync(sessionsDir)) return;

    // Delete sessions.json (session store)
    const storePath = path.join(sessionsDir, "sessions.json");
    if (fs.existsSync(storePath)) {
      fs.unlinkSync(storePath);
      logVerbose(`[arona-reset] Deleted session store: ${storePath}`);
    }

    // Delete all .jsonl transcript files
    const files = fs.readdirSync(sessionsDir);
    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        const filePath = path.join(sessionsDir, file);
        fs.unlinkSync(filePath);
        logVerbose(`[arona-reset] Deleted transcript: ${filePath}`);
      }
    }
  } catch (err) {
    logVerbose(`[arona-reset] Failed to reset sessions: ${String(err)}`);
  }
}

/**
 * Execute the full reset: mood + memory + sessions.
 */
async function executeFullReset(
  cfg: Parameters<CommandHandler>[0]["cfg"],
  agentId: string,
  workspaceDir: string,
): Promise<void> {
  logVerbose(`[arona-reset] Starting full reset for agent=${agentId}, workspace=${workspaceDir}`);

  resetMoodState(workspaceDir);
  await resetMemory(cfg, agentId);
  resetSessions(agentId);

  logVerbose(`[arona-reset] Full reset complete`);
}

// ── Command handler ─────────────────────────────────────────────

/**
 * Handle `/arona-reset` command.
 *
 * Flow:
 * 1. `/arona-reset` → Show initial warning + prompt step 1
 * 2. `/arona-reset yes` (1st) → Arona is worried, prompt step 2
 * 3. `/arona-reset yes` (2nd) → Arona is sad/pleading, prompt step 3
 * 4. `/arona-reset yes` (3rd) → Execute reset, Arona says goodbye
 *
 * Any other input or timeout → Cancel confirmation flow.
 */
export const handleAronaResetCommand: CommandHandler = async (
  params,
  allowTextCommands,
): Promise<CommandHandlerResult | null> => {
  if (!allowTextCommands) return null;

  const normalized = params.command.commandBodyNormalized;

  // Match /arona-reset with optional argument
  if (!normalized.startsWith("/arona-reset")) return null;
  if (normalized !== "/arona-reset" && !normalized.startsWith("/arona-reset ")) return null;

  // Authorization check
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /arona-reset from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  cleanExpired();

  const sessionKey = params.sessionKey || "default";
  const arg = normalized.slice("/arona-reset".length).trim().toLowerCase();

  // Check if this is a "yes" confirmation
  const isYes = arg === "yes" || arg === "y";

  // Check if this is an explicit cancel
  const isCancel = arg === "cancel" || arg === "no" || arg === "n" || arg === "hủy";

  // Initial trigger: /arona-reset (no args or non-yes/cancel args)
  if (!isYes && !isCancel && !PENDING_RESETS.has(sessionKey)) {
    // Start confirmation flow at step 0 → next yes moves to step 1
    PENDING_RESETS.set(sessionKey, {
      step: 0,
      expiresAt: Date.now() + CONFIRMATION_TIMEOUT_MS,
    });
    return {
      shouldContinue: false,
      reply: {
        text: [
          "Sensei muốn reset Arona...?",
          "",
          "Hành động này sẽ xóa:",
          "- Toàn bộ ký ức (memory database)",
          "- Tâm trạng & cảm xúc (mood state)",
          "- Lịch sử hội thoại (sessions)",
          "",
          "Những thứ **được giữ lại**: config, onboarding, workspace files.",
          "",
          "Nếu Sensei chắc chắn, hãy gõ `/arona-reset yes`.",
          "Gõ `/arona-reset cancel` để hủy.",
        ].join("\n"),
      },
    };
  }

  // Cancel flow
  if (isCancel) {
    PENDING_RESETS.delete(sessionKey);
    return {
      shouldContinue: false,
      reply: { text: CANCEL_RESPONSE },
    };
  }

  // If "yes" but no pending confirmation, treat as initial trigger
  const pending = PENDING_RESETS.get(sessionKey);
  if (!pending) {
    PENDING_RESETS.set(sessionKey, {
      step: 0,
      expiresAt: Date.now() + CONFIRMATION_TIMEOUT_MS,
    });
    return {
      shouldContinue: false,
      reply: {
        text: [
          "Sensei muốn reset Arona...?",
          "",
          "Hành động này sẽ xóa:",
          "- Toàn bộ ký ức (memory database)",
          "- Tâm trạng & cảm xúc (mood state)",
          "- Lịch sử hội thoại (sessions)",
          "",
          "Những thứ **được giữ lại**: config, onboarding, workspace files.",
          "",
          "Nếu Sensei chắc chắn, hãy gõ `/arona-reset yes`.",
          "Gõ `/arona-reset cancel` để hủy.",
        ].join("\n"),
      },
    };
  }

  // Not a "yes" during confirmation → cancel
  if (!isYes) {
    PENDING_RESETS.delete(sessionKey);
    return {
      shouldContinue: false,
      reply: { text: CANCEL_RESPONSE },
    };
  }

  // ── Process "yes" confirmation ──────────────────────────────

  const nextStep = pending.step + 1;

  // Steps 1 & 2: Show emotional response and advance
  if (nextStep <= 2) {
    PENDING_RESETS.set(sessionKey, {
      step: nextStep,
      expiresAt: Date.now() + CONFIRMATION_TIMEOUT_MS,
    });
    return {
      shouldContinue: false,
      reply: { text: STEP_RESPONSES[nextStep]! },
    };
  }

  // Step 3: Final confirmation → EXECUTE RESET
  PENDING_RESETS.delete(sessionKey);

  // Send the farewell message first
  const farewell = STEP_RESPONSES[3]!;

  // Execute the destructive reset
  const agentId = params.agentId || "main";
  try {
    await executeFullReset(params.cfg, agentId, params.workspaceDir);
  } catch (err) {
    logVerbose(`[arona-reset] Reset error: ${String(err)}`);
    return {
      shouldContinue: false,
      reply: {
        text: [
          farewell,
          "",
          "...Có lỗi xảy ra khi xóa một số dữ liệu.",
          `Chi tiết: ${String(err)}`,
          "Sensei có thể thử lại sau.",
        ].join("\n"),
      },
    };
  }

  return {
    shouldContinue: false,
    reply: {
      text: farewell + "\n\n" + RESET_COMPLETE_RESPONSE,
    },
  };
};

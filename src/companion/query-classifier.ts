/**
 * Query Complexity Classifier for Smart Model Routing.
 *
 * Classifies incoming user prompts into one of three tiers:
 * - **chat**: Casual greetings, emotions, small talk → fast model, no tools
 * - **knowledge**: Questions, explanations, advice → primary model, no tools
 * - **action**: Code, file ops, tool-based tasks → primary model, full tools
 *
 * Design principles:
 * - Waterfall: first matching rule wins
 * - Safe default: ambiguous → "knowledge" (primary model, no tools)
 * - Quality-first: never misclassify hard queries as easy
 */

export type QueryTier = "chat" | "knowledge" | "action";

// ── ACTION tier patterns ─────────────────────────────────────────────

/**
 * Keywords/phrases that strongly indicate the user wants tool execution.
 * Matched case-insensitively against the prompt.
 */
const ACTION_KEYWORDS = [
  // Code operations
  "code",
  "debug",
  "fix bug",
  "implement",
  "refactor",
  "compile",
  "build",
  "lint",
  "test",
  "deploy",
  "commit",
  "push",
  "pull",
  "merge",
  "rebase",
  "viết code",
  "sửa code",
  "sửa lỗi",
  "fix lỗi",
  // File operations
  "tạo file",
  "tạo thư mục",
  "create file",
  "create folder",
  "mkdir",
  "xóa file",
  "delete file",
  "rename file",
  "move file",
  "copy file",
  "đọc file",
  "read file",
  "edit file",
  "sửa file",
  "write file",
  // Shell / exec
  "chạy",
  "run ",
  "exec ",
  "execute",
  "terminal",
  "shell",
  "command",
  "npm ",
  "npx ",
  "pip ",
  "yarn ",
  "pnpm ",
  "cargo ",
  "docker ",
  "curl ",
  "wget ",
  "git ",
  // Search / web
  "search web",
  "tìm trên mạng",
  "web_search",
  "web_fetch",
  "browse",
  "fetch url",
  "tìm kiếm",
  // Cron / reminders
  "nhắc tôi",
  "remind ",
  "đặt lịch",
  "schedule",
  "cron",
  "hẹn giờ",
  "set timer",
  "set alarm",
  "wake me",
  // System operations
  "restart",
  "reload",
  "update",
  "config",
  "cấu hình",
  "check status",
  "gateway",
  "session",
  // Canvas / browser / nodes
  "canvas",
  "browser",
  "screenshot",
  "nodes",
  // Sub-agent / spawn
  "spawn",
  "subagent",
  "sub-agent",
  // Image analysis
  "analyze image",
  "phân tích ảnh",
  "xem ảnh",
] as const;

/**
 * Regex patterns that indicate action-tier queries.
 */
const ACTION_PATTERNS: RegExp[] = [
  // Code blocks
  /```[\s\S]*```/,
  /```\w*/,
  // File paths (e.g. src/foo/bar.ts, ./package.json)
  /(?:^|\s)(?:\.\/|src\/|\.\.\/)\S+\.\w+/,
  // Slash commands (but not /think which is knowledge)
  /^\/(?!think\b)(?:status|reset|new|compact|verbose|elevated|reasoning)\b/,
  // Explicit pipe/redirect commands
  /[|><]/,
];

// ── CHAT tier patterns ───────────────────────────────────────────────

/**
 * Greeting / small-talk patterns that indicate casual conversation.
 */
const CHAT_PATTERNS: RegExp[] = [
  // Greetings (Vietnamese + English + Japanese)
  /^(?:hi|hello|hey|yo|oi|chào|xin chào|ohayo|konnichiwa|konbanwa|oyasumi)\b/i,
  /^(?:arona|plana)\s*(?:ơi|oi|à|a|chan|~|!|♪|,|$)/i,
  // Thanks / acknowledgment
  /^(?:cảm ơn|cám ơn|thanks|thank you|thx|ty|tks|ok|okay|oke|ờ|ừ|ừm|uhm|uh huh|vâng|dạ)\s*[~!.♪]*\s*$/i,
  // Emotional reactions
  /^(?:vui|buồn|mệt|chán|stress|sad|happy|tired|bored|haha|hihi|hehe|lol|lmao|😂|🤣|❤️|💕|😭|😢|🥺|😊|🥰|uwu|owo)(?:\s+(?:quá|lắm|ghê|thế|vậy|nha|nè|á|ạ|đó))?\s*[~!.♪]*\s*$/i,
  // Short casual responses
  /^(?:đi ngủ|ngủ thôi|good night|gn|oyasumi|bye|tạm biệt|bai bai)\s*[~!.♪]*\s*$/i,
  // Affirmative short
  /^(?:rồi|xong|được|ok|okie|okee|gotcha|got it|roger|hiểu|hiểu rồi|biết rồi|oki)\s*[~!.♪]*\s*$/i,
];

/**
 * Max prompt length (in chars) for CHAT tier eligibility.
 * Longer messages typically indicate more complex requests.
 */
const CHAT_MAX_LENGTH = 80;

// ── KNOWLEDGE recall patterns ────────────────────────────────────────

/**
 * Patterns indicating the user wants to recall memory or past conversations.
 * These need the primary model + memory search but no tools.
 */
const KNOWLEDGE_RECALL_PATTERNS: RegExp[] = [
  /(?:nhớ|remember|recall|kể lại|nhắc lại)\s/i,
  /(?:lần trước|hôm qua|yesterday|last time|earlier|trước đó)/i,
  /(?:nói gì|said what|what did|đã nói|đã bảo|đã hỏi)/i,
  /(?:history|lịch sử|conversation|cuộc trò chuyện)/i,
];

// ── Classifier ───────────────────────────────────────────────────────

export interface ClassifyQueryParams {
  /** The user's prompt text. */
  prompt: string;
  /** Whether the message includes images or attachments. */
  hasImages?: boolean;
}

/**
 * Classify a user query into one of three tiers.
 *
 * Waterfall priority:
 * 1. ACTION signals (images, code blocks, action keywords)
 * 2. CHAT patterns (greetings, emotions, short casual)
 * 3. KNOWLEDGE recall patterns
 * 4. Default → "knowledge" (safe)
 */
export function classifyQueryTier(params: ClassifyQueryParams): QueryTier {
  const { prompt, hasImages } = params;
  const trimmed = prompt.trim();

  // ── 1. ACTION: images always need vision/tool capabilities (highest priority)
  if (hasImages) {
    return "action";
  }

  // ── Empty prompt → chat (will likely be a no-op or silent)
  if (!trimmed) {
    return "chat";
  }

  // ── 2. ACTION: code blocks present
  if (ACTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "action";
  }

  // ── 3. ACTION: action keywords present
  const lowerPrompt = trimmed.toLowerCase();
  if (ACTION_KEYWORDS.some((keyword) => lowerPrompt.includes(keyword))) {
    return "action";
  }

  // ── 4. CHAT: short + matches casual patterns
  if (trimmed.length <= CHAT_MAX_LENGTH && CHAT_PATTERNS.some((p) => p.test(trimmed))) {
    return "chat";
  }

  // ── 5. KNOWLEDGE: memory recall patterns
  if (KNOWLEDGE_RECALL_PATTERNS.some((p) => p.test(trimmed))) {
    return "knowledge";
  }

  // ── 6. CHAT: very short messages that look like casual filler
  // Only if they match a known casual pattern (single words, reactions, etc.)
  if (trimmed.length <= 30 && !/[?]/.test(trimmed) && CHAT_PATTERNS.some((p) => p.test(trimmed))) {
    return "chat";
  }

  // ── 7. Default → knowledge (safe: primary model, no tools)
  return "knowledge";
}

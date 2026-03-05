import { describe, it, expect } from "vitest";
import { classifyQueryTier } from "./query-classifier.js";

describe("classifyQueryTier", () => {
  // ── ACTION tier ──────────────────────────────────────────────────

  describe("ACTION tier", () => {
    it("classifies images as action", () => {
      expect(classifyQueryTier({ prompt: "what is this?", hasImages: true })).toBe("action");
    });

    it("classifies code blocks as action", () => {
      expect(classifyQueryTier({ prompt: "```js\nconsole.log('hi')\n```" })).toBe("action");
      expect(classifyQueryTier({ prompt: "fix this ```python\nprint('x')```" })).toBe("action");
    });

    it("classifies code-related keywords as action", () => {
      expect(classifyQueryTier({ prompt: "viết code Python xử lý CSV" })).toBe("action");
      expect(classifyQueryTier({ prompt: "debug cái API này giúp tôi" })).toBe("action");
      expect(classifyQueryTier({ prompt: "implement a new feature" })).toBe("action");
      expect(classifyQueryTier({ prompt: "refactor the login module" })).toBe("action");
      expect(classifyQueryTier({ prompt: "fix bug ở trang login" })).toBe("action");
    });

    it("classifies file operations as action", () => {
      expect(classifyQueryTier({ prompt: "tạo file README.md" })).toBe("action");
      expect(classifyQueryTier({ prompt: "đọc file config.json" })).toBe("action");
      expect(classifyQueryTier({ prompt: "edit file package.json" })).toBe("action");
      expect(classifyQueryTier({ prompt: "delete file temp.txt" })).toBe("action");
    });

    it("classifies shell/exec commands as action", () => {
      expect(classifyQueryTier({ prompt: "chạy npm install" })).toBe("action");
      expect(classifyQueryTier({ prompt: "run the test suite" })).toBe("action");
      expect(classifyQueryTier({ prompt: "npm start gateway" })).toBe("action");
      expect(classifyQueryTier({ prompt: "docker compose up" })).toBe("action");
      expect(classifyQueryTier({ prompt: "git push origin main" })).toBe("action");
    });

    it("classifies cron/reminder requests as action", () => {
      expect(classifyQueryTier({ prompt: "nhắc tôi lúc 3 giờ chiều" })).toBe("action");
      expect(classifyQueryTier({ prompt: "remind me to check email at 5pm" })).toBe("action");
      expect(classifyQueryTier({ prompt: "đặt lịch họp team thứ 2" })).toBe("action");
    });

    it("classifies web search as action", () => {
      expect(classifyQueryTier({ prompt: "search web for latest news" })).toBe("action");
      expect(classifyQueryTier({ prompt: "tìm trên mạng giá iPhone 16" })).toBe("action");
    });

    it("classifies slash commands as action", () => {
      expect(classifyQueryTier({ prompt: "/status" })).toBe("action");
      expect(classifyQueryTier({ prompt: "/reset" })).toBe("action");
    });

    it("classifies file paths as action", () => {
      expect(classifyQueryTier({ prompt: "look at src/config/types.ts" })).toBe("action");
      expect(classifyQueryTier({ prompt: "check ./package.json" })).toBe("action");
    });
  });

  // ── CHAT tier ────────────────────────────────────────────────────

  describe("CHAT tier", () => {
    it("classifies greetings as chat", () => {
      expect(classifyQueryTier({ prompt: "hi" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "hello" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "hey" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "chào" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "xin chào" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "ohayo" })).toBe("chat");
    });

    it("classifies Arona/Plana calls as chat", () => {
      expect(classifyQueryTier({ prompt: "Arona ơi" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "Arona~" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "Plana ơi" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "Arona!" })).toBe("chat");
    });

    it("classifies emotional reactions as chat", () => {
      expect(classifyQueryTier({ prompt: "vui quá~" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "buồn" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "mệt" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "haha" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "😂" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "❤️" })).toBe("chat");
    });

    it("classifies short thank-you as chat", () => {
      expect(classifyQueryTier({ prompt: "cảm ơn~" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "thanks!" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "ok" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "ừ" })).toBe("chat");
    });

    it("classifies goodnight as chat", () => {
      expect(classifyQueryTier({ prompt: "đi ngủ~" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "good night" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "oyasumi" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "bye" })).toBe("chat");
    });

    it("classifies very short casual messages as chat", () => {
      expect(classifyQueryTier({ prompt: "yo" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "lol" })).toBe("chat");
    });

    it("classifies ambiguous short messages as knowledge", () => {
      expect(classifyQueryTier({ prompt: "hmm" })).toBe("knowledge");
    });

    it("classifies empty prompt as chat", () => {
      expect(classifyQueryTier({ prompt: "" })).toBe("chat");
      expect(classifyQueryTier({ prompt: "   " })).toBe("chat");
    });
  });

  // ── KNOWLEDGE tier ───────────────────────────────────────────────

  describe("KNOWLEDGE tier", () => {
    it("classifies explanations as knowledge", () => {
      expect(classifyQueryTier({ prompt: "giải thích async/await cho tôi" })).toBe("knowledge");
      expect(classifyQueryTier({ prompt: "so sánh React vs Vue" })).toBe("knowledge");
      expect(classifyQueryTier({ prompt: "what is the difference between TCP and UDP?" })).toBe(
        "knowledge",
      );
    });

    it("classifies memory recall as knowledge", () => {
      expect(classifyQueryTier({ prompt: "hôm qua tôi nói gì ấy nhỉ?" })).toBe("knowledge");
      expect(classifyQueryTier({ prompt: "nhớ lại lần trước mình làm gì" })).toBe("knowledge");
      expect(classifyQueryTier({ prompt: "do you remember what we discussed?" })).toBe("knowledge");
    });

    it("classifies longer questions as knowledge", () => {
      expect(
        classifyQueryTier({
          prompt:
            "Arona ơi, tôi đang phân vân giữa việc dùng PostgreSQL hay MongoDB cho project mới, theo Arona nên dùng cái nào?",
        }),
      ).toBe("knowledge");
    });

    it("classifies advice requests as knowledge", () => {
      expect(classifyQueryTier({ prompt: "nên dùng framework nào cho mobile app?" })).toBe(
        "knowledge",
      );
      expect(classifyQueryTier({ prompt: "cách tốt nhất để học TypeScript là gì?" })).toBe(
        "knowledge",
      );
    });

    it("defaults ambiguous queries to knowledge", () => {
      expect(classifyQueryTier({ prompt: "tôi muốn hỏi về kiến trúc microservices" })).toBe(
        "knowledge",
      );
      expect(classifyQueryTier({ prompt: "explain the concept of dependency injection" })).toBe(
        "knowledge",
      );
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────

  describe("edge cases", () => {
    it("action keywords win over chat length", () => {
      // Short but has action keyword
      expect(classifyQueryTier({ prompt: "fix bug" })).toBe("action");
      expect(classifyQueryTier({ prompt: "run npm" })).toBe("action");
    });

    it("images override everything", () => {
      expect(classifyQueryTier({ prompt: "hi", hasImages: true })).toBe("action");
      expect(classifyQueryTier({ prompt: "", hasImages: true })).toBe("action");
    });

    it("questions with ? under 30 chars go to knowledge not chat", () => {
      expect(classifyQueryTier({ prompt: "mấy giờ rồi?" })).toBe("knowledge");
    });

    it("does not false-positive on partial keyword matches", () => {
      // "run" as part of words should not match "run " (with space)
      expect(classifyQueryTier({ prompt: "runtime error là gì?" })).not.toBe("chat");
    });
  });
});

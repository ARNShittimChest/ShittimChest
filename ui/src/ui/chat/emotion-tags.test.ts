import { describe, expect, it, vi } from "vitest";
import { extractEmotionTag, stripEmotionTag, dispatchEmotionEvent } from "./emotion-tags.ts";

describe("extractEmotionTag", () => {
  it("extracts happy tag", () => {
    expect(extractEmotionTag("[happy] Hello!")).toBe("happy");
  });

  it("extracts case-insensitive tag", () => {
    expect(extractEmotionTag("[EXCITED] Yay!")).toBe("excited");
  });

  it("returns null when no tag", () => {
    expect(extractEmotionTag("Hello!")).toBeNull();
  });

  it("returns null for unknown tag", () => {
    expect(extractEmotionTag("[angry] Grr!")).toBeNull();
  });

  it("handles leading whitespace", () => {
    expect(extractEmotionTag("  [sad] ...")).toBe("sad");
  });

  it("returns null for mid-text tag", () => {
    expect(extractEmotionTag("Hello [happy] world")).toBeNull();
  });
});

describe("stripEmotionTag", () => {
  it("strips tag from start", () => {
    expect(stripEmotionTag("[happy] Hello!")).toBe("Hello!");
  });

  it("preserves text without tag", () => {
    expect(stripEmotionTag("Hello!")).toBe("Hello!");
  });

  it("strips with leading whitespace", () => {
    expect(stripEmotionTag("  [worried] Oh no")).toBe("Oh no");
  });

  it("only strips first tag", () => {
    expect(stripEmotionTag("[happy] [sad] mixed")).toBe("[sad] mixed");
  });
});

describe("dispatchEmotionEvent", () => {
  it("dispatches spine:emotion CustomEvent", () => {
    const listener = vi.fn();
    document.addEventListener("spine:emotion", listener);
    try {
      dispatchEmotionEvent("caring");
      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({ mood: "caring" });
    } finally {
      document.removeEventListener("spine:emotion", listener);
    }
  });
});

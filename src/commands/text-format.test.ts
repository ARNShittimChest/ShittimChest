import { describe, expect, it } from "vitest";
import { shortenText } from "./text-format.js";

describe("shortenText", () => {
  it("returns original text when it fits", () => {
    expect(shortenText("shittimchest", 16)).toBe("shittimchest");
  });

  it("truncates and appends ellipsis when over limit", () => {
    expect(shortenText("shittimchest-status-output", 10)).toBe("shittimchest-…");
  });

  it("counts multi-byte characters correctly", () => {
    expect(shortenText("hello🙂world", 7)).toBe("hello🙂…");
  });
});

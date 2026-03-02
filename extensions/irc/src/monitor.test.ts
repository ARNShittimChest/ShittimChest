import { describe, expect, it } from "vitest";
import { resolveIrcInboundTarget } from "./monitor.js";

describe("irc monitor inbound target", () => {
  it("keeps channel target for group messages", () => {
    expect(
      resolveIrcInboundTarget({
        target: "#shittimchest",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: true,
      target: "#shittimchest",
      rawTarget: "#shittimchest",
    });
  });

  it("maps DM target to sender nick and preserves raw target", () => {
    expect(
      resolveIrcInboundTarget({
        target: "shittimchest-bot",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: false,
      target: "alice",
      rawTarget: "shittimchest-bot",
    });
  });

  it("falls back to raw target when sender nick is empty", () => {
    expect(
      resolveIrcInboundTarget({
        target: "shittimchest-bot",
        senderNick: " ",
      }),
    ).toEqual({
      isGroup: false,
      target: "shittimchest-bot",
      rawTarget: "shittimchest-bot",
    });
  });
});

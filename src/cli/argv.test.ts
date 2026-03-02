import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it.each([
    {
      name: "help flag",
      argv: ["node", "shittimchest", "--help"],
      expected: true,
    },
    {
      name: "version flag",
      argv: ["node", "shittimchest", "-V"],
      expected: true,
    },
    {
      name: "normal command",
      argv: ["node", "shittimchest", "status"],
      expected: false,
    },
    {
      name: "root -v alias",
      argv: ["node", "shittimchest", "-v"],
      expected: true,
    },
    {
      name: "root -v alias with profile",
      argv: ["node", "shittimchest", "--profile", "work", "-v"],
      expected: true,
    },
    {
      name: "root -v alias with log-level",
      argv: ["node", "shittimchest", "--log-level", "debug", "-v"],
      expected: true,
    },
    {
      name: "subcommand -v should not be treated as version",
      argv: ["node", "shittimchest", "acp", "-v"],
      expected: false,
    },
    {
      name: "root -v alias with equals profile",
      argv: ["node", "shittimchest", "--profile=work", "-v"],
      expected: true,
    },
    {
      name: "subcommand path after global root flags should not be treated as version",
      argv: ["node", "shittimchest", "--dev", "skills", "list", "-v"],
      expected: false,
    },
  ])("detects help/version flags: $name", ({ argv, expected }) => {
    expect(hasHelpOrVersion(argv)).toBe(expected);
  });

  it.each([
    {
      name: "single command with trailing flag",
      argv: ["node", "shittimchest", "status", "--json"],
      expected: ["status"],
    },
    {
      name: "two-part command",
      argv: ["node", "shittimchest", "agents", "list"],
      expected: ["agents", "list"],
    },
    {
      name: "terminator cuts parsing",
      argv: ["node", "shittimchest", "status", "--", "ignored"],
      expected: ["status"],
    },
  ])("extracts command path: $name", ({ argv, expected }) => {
    expect(getCommandPath(argv, 2)).toEqual(expected);
  });

  it.each([
    {
      name: "returns first command token",
      argv: ["node", "shittimchest", "agents", "list"],
      expected: "agents",
    },
    {
      name: "returns null when no command exists",
      argv: ["node", "shittimchest"],
      expected: null,
    },
  ])("returns primary command: $name", ({ argv, expected }) => {
    expect(getPrimaryCommand(argv)).toBe(expected);
  });

  it.each([
    {
      name: "detects flag before terminator",
      argv: ["node", "shittimchest", "status", "--json"],
      flag: "--json",
      expected: true,
    },
    {
      name: "ignores flag after terminator",
      argv: ["node", "shittimchest", "--", "--json"],
      flag: "--json",
      expected: false,
    },
  ])("parses boolean flags: $name", ({ argv, flag, expected }) => {
    expect(hasFlag(argv, flag)).toBe(expected);
  });

  it.each([
    {
      name: "value in next token",
      argv: ["node", "shittimchest", "status", "--timeout", "5000"],
      expected: "5000",
    },
    {
      name: "value in equals form",
      argv: ["node", "shittimchest", "status", "--timeout=2500"],
      expected: "2500",
    },
    {
      name: "missing value",
      argv: ["node", "shittimchest", "status", "--timeout"],
      expected: null,
    },
    {
      name: "next token is another flag",
      argv: ["node", "shittimchest", "status", "--timeout", "--json"],
      expected: null,
    },
    {
      name: "flag appears after terminator",
      argv: ["node", "shittimchest", "--", "--timeout=99"],
      expected: undefined,
    },
  ])("extracts flag values: $name", ({ argv, expected }) => {
    expect(getFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "shittimchest", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "shittimchest", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "shittimchest", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it.each([
    {
      name: "missing flag",
      argv: ["node", "shittimchest", "status"],
      expected: undefined,
    },
    {
      name: "missing value",
      argv: ["node", "shittimchest", "status", "--timeout"],
      expected: null,
    },
    {
      name: "valid positive integer",
      argv: ["node", "shittimchest", "status", "--timeout", "5000"],
      expected: 5000,
    },
    {
      name: "invalid integer",
      argv: ["node", "shittimchest", "status", "--timeout", "nope"],
      expected: undefined,
    },
  ])("parses positive integer flag values: $name", ({ argv, expected }) => {
    expect(getPositiveIntFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("builds parse argv from raw args", () => {
    const cases = [
      {
        rawArgs: ["node", "shittimchest", "status"],
        expected: ["node", "shittimchest", "status"],
      },
      {
        rawArgs: ["node-22", "shittimchest", "status"],
        expected: ["node-22", "shittimchest", "status"],
      },
      {
        rawArgs: ["node-22.2.0.exe", "shittimchest", "status"],
        expected: ["node-22.2.0.exe", "shittimchest", "status"],
      },
      {
        rawArgs: ["node-22.2", "shittimchest", "status"],
        expected: ["node-22.2", "shittimchest", "status"],
      },
      {
        rawArgs: ["node-22.2.exe", "shittimchest", "status"],
        expected: ["node-22.2.exe", "shittimchest", "status"],
      },
      {
        rawArgs: ["/usr/bin/node-22.2.0", "shittimchest", "status"],
        expected: ["/usr/bin/node-22.2.0", "shittimchest", "status"],
      },
      {
        rawArgs: ["node24", "shittimchest", "status"],
        expected: ["node24", "shittimchest", "status"],
      },
      {
        rawArgs: ["/usr/bin/node24", "shittimchest", "status"],
        expected: ["/usr/bin/node24", "shittimchest", "status"],
      },
      {
        rawArgs: ["node24.exe", "shittimchest", "status"],
        expected: ["node24.exe", "shittimchest", "status"],
      },
      {
        rawArgs: ["nodejs", "shittimchest", "status"],
        expected: ["nodejs", "shittimchest", "status"],
      },
      {
        rawArgs: ["node-dev", "shittimchest", "status"],
        expected: ["node", "shittimchest", "node-dev", "shittimchest", "status"],
      },
      {
        rawArgs: ["shittimchest", "status"],
        expected: ["node", "shittimchest", "status"],
      },
      {
        rawArgs: ["bun", "src/entry.ts", "status"],
        expected: ["bun", "src/entry.ts", "status"],
      },
    ] as const;

    for (const testCase of cases) {
      const parsed = buildParseArgv({
        programName: "shittimchest",
        rawArgs: [...testCase.rawArgs],
      });
      expect(parsed).toEqual([...testCase.expected]);
    }
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "shittimchest",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "shittimchest", "status"]);
  });

  it("decides when to migrate state", () => {
    const nonMutatingArgv = [
      ["node", "shittimchest", "status"],
      ["node", "shittimchest", "health"],
      ["node", "shittimchest", "sessions"],
      ["node", "shittimchest", "config", "get", "update"],
      ["node", "shittimchest", "config", "unset", "update"],
      ["node", "shittimchest", "models", "list"],
      ["node", "shittimchest", "models", "status"],
      ["node", "shittimchest", "memory", "status"],
      ["node", "shittimchest", "agent", "--message", "hi"],
    ] as const;
    const mutatingArgv = [
      ["node", "shittimchest", "agents", "list"],
      ["node", "shittimchest", "message", "send"],
    ] as const;

    for (const argv of nonMutatingArgv) {
      expect(shouldMigrateState([...argv])).toBe(false);
    }
    for (const argv of mutatingArgv) {
      expect(shouldMigrateState([...argv])).toBe(true);
    }
  });

  it.each([
    { path: ["status"], expected: false },
    { path: ["config", "get"], expected: false },
    { path: ["models", "status"], expected: false },
    { path: ["agents", "list"], expected: true },
  ])("reuses command path for migrate state decisions: $path", ({ path, expected }) => {
    expect(shouldMigrateStateFromPath(path)).toBe(expected);
  });
});

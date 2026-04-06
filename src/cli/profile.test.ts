import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "shittimchest",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "shittimchest", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "shittimchest", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "shittimchest", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "shittimchest", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "shittimchest", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "shittimchest", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "shittimchest", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "shittimchest", "--profile", "work", "--dev", "status"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".shittimchest-dev");
    expect(env.SHITTIMCHEST_PROFILE).toBe("dev");
    expect(env.SHITTIMCHEST_STATE_DIR).toBe(expectedStateDir);
    expect(env.SHITTIMCHEST_CONFIG_PATH).toBe(path.join(expectedStateDir, "shittimchest.json"));
    expect(env.SHITTIMCHEST_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      SHITTIMCHEST_STATE_DIR: "/custom",
      SHITTIMCHEST_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.SHITTIMCHEST_STATE_DIR).toBe("/custom");
    expect(env.SHITTIMCHEST_GATEWAY_PORT).toBe("19099");
    expect(env.SHITTIMCHEST_CONFIG_PATH).toBe(path.join("/custom", "shittimchest.json"));
  });

  it("uses SHITTIMCHEST_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      SHITTIMCHEST_HOME: "/srv/shittimchest-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/shittimchest-home");
    expect(env.SHITTIMCHEST_STATE_DIR).toBe(path.join(resolvedHome, ".shittimchest-work"));
    expect(env.SHITTIMCHEST_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".shittimchest-work", "shittimchest.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "shittimchest doctor --fix",
      env: {},
      expected: "shittimchest doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "shittimchest doctor --fix",
      env: { SHITTIMCHEST_PROFILE: "default" },
      expected: "shittimchest doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "shittimchest doctor --fix",
      env: { SHITTIMCHEST_PROFILE: "Default" },
      expected: "shittimchest doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "shittimchest doctor --fix",
      env: { SHITTIMCHEST_PROFILE: "bad profile" },
      expected: "shittimchest doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "shittimchest --profile work doctor --fix",
      env: { SHITTIMCHEST_PROFILE: "work" },
      expected: "shittimchest --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "shittimchest --dev doctor",
      env: { SHITTIMCHEST_PROFILE: "dev" },
      expected: "shittimchest --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("shittimchest doctor --fix", { SHITTIMCHEST_PROFILE: "work" })).toBe(
      "shittimchest --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(
      formatCliCommand("shittimchest doctor --fix", { SHITTIMCHEST_PROFILE: "  jbshittimchest  " }),
    ).toBe("shittimchest --profile jbshittimchest doctor --fix");
  });

  it("handles command with no args after shittimchest", () => {
    expect(formatCliCommand("shittimchest", { SHITTIMCHEST_PROFILE: "test" })).toBe(
      "shittimchest --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm shittimchest doctor", { SHITTIMCHEST_PROFILE: "work" })).toBe(
      "pnpm shittimchest --profile work doctor",
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { captureFullEnv } from "../test-utils/env.js";
import { SUPERVISOR_HINT_ENV_VARS } from "./supervisor-markers.js";

const spawnMock = vi.hoisted(() => vi.fn());
const triggerShittimChestRestartMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));
vi.mock("./restart.js", () => ({
  triggerShittimChestRestart: (...args: unknown[]) => triggerShittimChestRestartMock(...args),
}));

import { restartGatewayProcessWithFreshPid } from "./process-respawn.js";

const originalArgv = [...process.argv];
const originalExecArgv = [...process.execArgv];
const envSnapshot = captureFullEnv();
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

function setPlatform(platform: string) {
  if (!originalPlatformDescriptor) {
    return;
  }
  Object.defineProperty(process, "platform", {
    ...originalPlatformDescriptor,
    value: platform,
  });
}

afterEach(() => {
  envSnapshot.restore();
  process.argv = [...originalArgv];
  process.execArgv = [...originalExecArgv];
  spawnMock.mockClear();
  triggerShittimChestRestartMock.mockClear();
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, "platform", originalPlatformDescriptor);
  }
});

function clearSupervisorHints() {
  for (const key of SUPERVISOR_HINT_ENV_VARS) {
    delete process.env[key];
  }
}

describe("restartGatewayProcessWithFreshPid", () => {
  it("returns disabled when SHITTIMCHEST_NO_RESPAWN is set", () => {
    process.env.SHITTIMCHEST_NO_RESPAWN = "1";
    const result = restartGatewayProcessWithFreshPid();
    expect(result.mode).toBe("disabled");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns supervised when launchd/systemd hints are present", () => {
    process.env.LAUNCH_JOB_LABEL = "ai.shittimchest.gateway";
    const result = restartGatewayProcessWithFreshPid();
    expect(result.mode).toBe("supervised");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("runs launchd kickstart helper on macOS when launchd label is set", () => {
    setPlatform("darwin");
    process.env.LAUNCH_JOB_LABEL = "ai.shittimchest.gateway";
    process.env.SHITTIMCHEST_LAUNCHD_LABEL = "ai.shittimchest.gateway";
    triggerShittimChestRestartMock.mockReturnValue({ ok: true, method: "launchctl" });

    const result = restartGatewayProcessWithFreshPid();

    expect(result.mode).toBe("supervised");
    expect(triggerShittimChestRestartMock).toHaveBeenCalledOnce();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns failed when launchd kickstart helper fails", () => {
    setPlatform("darwin");
    process.env.LAUNCH_JOB_LABEL = "ai.shittimchest.gateway";
    process.env.SHITTIMCHEST_LAUNCHD_LABEL = "ai.shittimchest.gateway";
    triggerShittimChestRestartMock.mockReturnValue({
      ok: false,
      method: "launchctl",
      detail: "spawn failed",
    });

    const result = restartGatewayProcessWithFreshPid();

    expect(result.mode).toBe("failed");
    expect(result.detail).toContain("spawn failed");
  });

  it("does not schedule kickstart on non-darwin platforms", () => {
    setPlatform("linux");
    process.env.INVOCATION_ID = "abc123";
    process.env.SHITTIMCHEST_LAUNCHD_LABEL = "ai.shittimchest.gateway";

    const result = restartGatewayProcessWithFreshPid();

    expect(result.mode).toBe("supervised");
    expect(triggerShittimChestRestartMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawns detached child with current exec argv", () => {
    delete process.env.SHITTIMCHEST_NO_RESPAWN;
    clearSupervisorHints();
    process.execArgv = ["--import", "tsx"];
    process.argv = ["/usr/local/bin/node", "/repo/dist/index.js", "gateway", "run"];
    spawnMock.mockReturnValue({ pid: 4242, unref: vi.fn() });

    const result = restartGatewayProcessWithFreshPid();

    expect(result).toEqual({ mode: "spawned", pid: 4242 });
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      ["--import", "tsx", "/repo/dist/index.js", "gateway", "run"],
      expect.objectContaining({
        detached: true,
        stdio: "inherit",
      }),
    );
  });

  it("returns supervised when SHITTIMCHEST_LAUNCHD_LABEL is set (stock launchd plist)", () => {
    clearSupervisorHints();
    setPlatform("darwin");
    process.env.SHITTIMCHEST_LAUNCHD_LABEL = "ai.shittimchest.gateway";
    triggerShittimChestRestartMock.mockReturnValue({ ok: true, method: "launchctl" });
    const result = restartGatewayProcessWithFreshPid();
    expect(result.mode).toBe("supervised");
    expect(triggerShittimChestRestartMock).toHaveBeenCalledOnce();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns supervised when SHITTIMCHEST_SYSTEMD_UNIT is set", () => {
    clearSupervisorHints();
    process.env.SHITTIMCHEST_SYSTEMD_UNIT = "shittimchest-gateway.service";
    const result = restartGatewayProcessWithFreshPid();
    expect(result.mode).toBe("supervised");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns supervised when SHITTIMCHEST_SERVICE_MARKER is set", () => {
    clearSupervisorHints();
    process.env.SHITTIMCHEST_SERVICE_MARKER = "gateway";
    const result = restartGatewayProcessWithFreshPid();
    expect(result.mode).toBe("supervised");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns failed when spawn throws", () => {
    delete process.env.SHITTIMCHEST_NO_RESPAWN;
    clearSupervisorHints();

    spawnMock.mockImplementation(() => {
      throw new Error("spawn failed");
    });
    const result = restartGatewayProcessWithFreshPid();
    expect(result.mode).toBe("failed");
    expect(result.detail).toContain("spawn failed");
  });
});

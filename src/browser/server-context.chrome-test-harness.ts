import { vi } from "vitest";
import { installChromeUserDataDirHooks } from "./chrome-user-data-dir.test-harness.js";

const chromeUserDataDir = { dir: "/tmp/shittimchest" };
installChromeUserDataDirHooks(chromeUserDataDir);

vi.mock("./chrome.js", () => ({
  isChromeCdpReady: vi.fn(async () => true),
  isChromeReachable: vi.fn(async () => true),
  launchShittimChestChrome: vi.fn(async () => {
    throw new Error("unexpected launch");
  }),
  resolveShittimChestUserDataDir: vi.fn(() => chromeUserDataDir.dir),
  stopShittimChestChrome: vi.fn(async () => {}),
}));

import { describe, expect, it } from "vitest";
import type { ShittimChestConfig } from "../../config/config.js";
import { createAccountListHelpers } from "./account-helpers.js";

const { listConfiguredAccountIds, listAccountIds, resolveDefaultAccountId } =
  createAccountListHelpers("testchannel");

function cfg(accounts?: Record<string, unknown> | null): ShittimChestConfig {
  if (accounts === null) {
    return { channels: { testchannel: {} } } as unknown as ShittimChestConfig;
  }
  if (accounts === undefined) {
    return {} as unknown as ShittimChestConfig;
  }
  return { channels: { testchannel: { accounts } } } as unknown as ShittimChestConfig;
}

describe("createAccountListHelpers", () => {
  describe("listConfiguredAccountIds", () => {
    it("returns empty for missing config", () => {
      expect(listConfiguredAccountIds({} as ShittimChestConfig)).toEqual([]);
    });

    it("returns empty when no accounts key", () => {
      expect(listConfiguredAccountIds(cfg(null))).toEqual([]);
    });

    it("returns empty for empty accounts object", () => {
      expect(listConfiguredAccountIds(cfg({}))).toEqual([]);
    });

    it("filters out empty keys", () => {
      expect(listConfiguredAccountIds(cfg({ "": {}, a: {} }))).toEqual(["a"]);
    });

    it("returns account keys", () => {
      expect(listConfiguredAccountIds(cfg({ work: {}, personal: {} }))).toEqual([
        "work",
        "personal",
      ]);
    });
  });

  describe("listAccountIds", () => {
    it('returns ["default"] for empty config', () => {
      expect(listAccountIds({} as ShittimChestConfig)).toEqual(["default"]);
    });

    it('returns ["default"] for empty accounts', () => {
      expect(listAccountIds(cfg({}))).toEqual(["default"]);
    });

    it("returns sorted ids", () => {
      expect(listAccountIds(cfg({ z: {}, a: {}, m: {} }))).toEqual(["a", "m", "z"]);
    });
  });

  describe("resolveDefaultAccountId", () => {
    it('returns "default" when present', () => {
      expect(resolveDefaultAccountId(cfg({ default: {}, other: {} }))).toBe("default");
    });

    it("returns first sorted id when no default", () => {
      expect(resolveDefaultAccountId(cfg({ beta: {}, alpha: {} }))).toBe("alpha");
    });

    it('returns "default" for empty config', () => {
      expect(resolveDefaultAccountId({} as ShittimChestConfig)).toBe("default");
    });
  });
});

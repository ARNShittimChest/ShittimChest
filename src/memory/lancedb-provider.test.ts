import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock "@lancedb/lancedb" before importing the provider
// LanceDbProvider uses a dynamic import internally, so we intercept at module level.
vi.mock("@lancedb/lancedb", () => {
  const rows: Record<string, unknown>[] = [];

  const mockTable = {
    add: vi.fn(async (entries: Record<string, unknown>[]) => {
      rows.push(...entries);
    }),
    delete: vi.fn(async () => {}),
    countRows: vi.fn(async () => rows.length),
    vectorSearch: vi.fn(() => ({
      limit: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      toArray: vi.fn(async () =>
        rows.map((r) => ({
          ...r,
          _distance: 0.1,
        })),
      ),
    })),
  };

  const mockDb = {
    tableNames: vi.fn(async () => []),
    openTable: vi.fn(async () => mockTable),
    createTable: vi.fn(async (_name: string, _seed: unknown[]) => {
      // createTable is called once with a schema seed row; table is empty after delete
      return mockTable;
    }),
  };

  return {
    connect: vi.fn(async () => mockDb),
    __mockRows: rows,
    __mockTable: mockTable,
  };
});

import { LanceDbProvider } from "./lancedb-provider.js";

describe("LanceDbProvider", () => {
  let provider: LanceDbProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LanceDbProvider("/tmp/test-lancedb", 4);
  });

  it("store() adds an entry and returns it with generated id and createdAt", async () => {
    const entry = await provider.store({
      role: "user",
      text: "Hello world",
      vector: [0.1, 0.2, 0.3, 0.4],
      source_file: "test",
      category: "chat_log",
    });

    expect(entry.id).toBeTruthy();
    expect(entry.text).toBe("Hello world");
    expect(entry.role).toBe("user");
    expect(entry.category).toBe("chat_log");
    expect(entry.importance).toBe(1.0);
    expect(entry.createdAt).toBeGreaterThan(0);
  });

  it("store() respects custom importance value", async () => {
    const entry = await provider.store({
      role: "system",
      text: "Sensei dislikes spicy food",
      vector: [0.1, 0.2, 0.3, 0.4],
      source_file: "profiler",
      category: "sensei_profile",
      importance: 2.0,
    });

    expect(entry.importance).toBe(2.0);
    expect(entry.category).toBe("sensei_profile");
  });

  it("storeBatch() stores multiple entries at once", async () => {
    const entries = await provider.storeBatch([
      {
        role: "user",
        text: "Message one",
        vector: [0.1, 0.1, 0.1, 0.1],
        source_file: "chat/agent",
        category: "chat_log",
      },
      {
        role: "assistant",
        text: "Response one",
        vector: [0.2, 0.2, 0.2, 0.2],
        source_file: "chat/agent",
        category: "chat_log",
      },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]?.role).toBe("user");
    expect(entries[1]?.role).toBe("assistant");
    // Each should have a unique id
    expect(entries[0]?.id).not.toBe(entries[1]?.id);
  });

  it("storeBatch() returns empty array for empty input", async () => {
    const entries = await provider.storeBatch([]);
    expect(entries).toHaveLength(0);
  });

  it("search() returns results with computed scores", async () => {
    await provider.store({
      role: "user",
      text: "I hate spicy food",
      vector: [0.5, 0.5, 0.5, 0.5],
      source_file: "chat/agent",
      category: "chat_log",
    });

    const results = await provider.search([0.5, 0.5, 0.5, 0.5], 5);
    expect(results.length).toBeGreaterThan(0);
    // score = 1 / (1 + distance) where distance = 0.1 → ~0.909
    expect(results[0]?.score).toBeCloseTo(1 / (1 + 0.1), 2);
  });

  it("search() filters by category when specified", async () => {
    const results = await provider.search([0.1, 0.1, 0.1, 0.1], 5, {
      category: "sensei_profile",
    });
    // With our mock, vectorSearch().where() is called — just verify no error thrown
    expect(Array.isArray(results)).toBe(true);
  });

  it("count() returns the number of stored entries", async () => {
    const count = await provider.count();
    // Mock countRows always returns number of rows pushed
    expect(typeof count).toBe("number");
  });

  it("close() resets internal state cleanly", async () => {
    // Trigger initialization
    await provider.count();
    await provider.close();

    // After close, a second close should be a no-op (no throw)
    await expect(provider.close()).resolves.toBeUndefined();
  });
});

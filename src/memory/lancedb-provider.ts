import { randomUUID } from "node:crypto";
import type * as LanceDB from "@lancedb/lancedb";

export type MemoryCategory = "chat_log" | "fact" | "entity_summary" | "sensei_profile" | "other";

export type MemoryEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  vector: number[];
  source_file: string;
  category: MemoryCategory;
  importance: number;
  createdAt: number;
};

export type LanceDbSearchResult = {
  entry: MemoryEntry;
  score: number;
};

const TABLE_NAME = "deep_memory";

let lancedbImportPromise: Promise<typeof import("@lancedb/lancedb")> | null = null;
const loadLanceDB = async (): Promise<typeof import("@lancedb/lancedb")> => {
  if (!lancedbImportPromise) {
    lancedbImportPromise = import("@lancedb/lancedb");
  }
  try {
    return await lancedbImportPromise;
  } catch (err) {
    throw new Error(`lancedb-provider: failed to load LanceDB. ${String(err)}`, { cause: err });
  }
};

export class LanceDbProvider {
  private db: LanceDB.Connection | null = null;
  private table: LanceDB.Table | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly vectorDim: number,
  ) {}

  private async ensureInitialized(): Promise<void> {
    if (this.table) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const lancedb = await loadLanceDB();
    this.db = await lancedb.connect(this.dbPath);
    const tables = await this.db.tableNames();

    if (tables.includes(TABLE_NAME)) {
      this.table = await this.db.openTable(TABLE_NAME);
    } else {
      this.table = await this.db.createTable(TABLE_NAME, [
        {
          id: "__schema__",
          role: "system",
          text: "",
          vector: Array.from({ length: this.vectorDim }).fill(0),
          source_file: "",
          category: "other",
          importance: 0,
          createdAt: 0,
        },
      ]);
      await this.table.delete('id = "__schema__"');
    }
  }

  async store(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "importance"> & { importance?: number },
  ): Promise<MemoryEntry> {
    await this.ensureInitialized();

    const fullEntry: MemoryEntry = {
      ...entry,
      id: randomUUID(),
      importance: entry.importance ?? 1.0,
      createdAt: Date.now(),
    };

    await this.table!.add([fullEntry]);
    return fullEntry;
  }

  async storeBatch(
    entries: Array<Omit<MemoryEntry, "id" | "createdAt" | "importance"> & { importance?: number }>,
  ): Promise<MemoryEntry[]> {
    await this.ensureInitialized();

    if (entries.length === 0) return [];

    const fullEntries: MemoryEntry[] = entries.map((entry) => ({
      ...entry,
      id: randomUUID(),
      importance: entry.importance ?? 1.0,
      createdAt: Date.now(),
    }));

    await this.table!.add(fullEntries);
    return fullEntries;
  }

  async search(
    vector: number[],
    limit = 5,
    options?: { minScore?: number; role?: string; category?: MemoryCategory },
  ): Promise<LanceDbSearchResult[]> {
    await this.ensureInitialized();

    let query = this.table!.vectorSearch(vector).limit(limit);

    // Apply filters if provided
    let filterClauses: string[] = [];
    if (options?.role) {
      filterClauses.push(`role = '${options.role}'`);
    }
    if (options?.category) {
      filterClauses.push(`category = '${options.category}'`);
    }

    if (filterClauses.length > 0) {
      query = query.where(filterClauses.join(" AND "));
    }

    const results = await query.toArray();

    const minScoreThreshold = options?.minScore ?? 0.0;

    const mapped = results.map((row) => {
      const distance = row._distance ?? 0;
      const score = 1 / (1 + distance);
      return {
        entry: {
          id: row.id as string,
          role: row.role as MemoryEntry["role"],
          text: row.text as string,
          vector: row.vector as number[],
          source_file: row.source_file as string,
          category: row.category as MemoryEntry["category"],
          importance: row.importance as number,
          createdAt: row.createdAt as number,
        },
        score,
      };
    });

    return mapped.filter((r) => r.score >= minScoreThreshold);
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    return this.table!.countRows();
  }

  async close(): Promise<void> {
    // LanceDB connection closing logic if needed
    this.table = null;
    this.db = null;
    this.initPromise = null;
  }
}

/**
 * Drop-in replacement for LanceDbProvider using SQLite + sqlite-vec.
 * Works on all platforms where sqlite-vec is available (including darwin-x64).
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { MemoryCategory, MemoryEntry, LanceDbSearchResult } from "./lancedb-provider.js";
import { ensureDir } from "./internal.js";
import { requireNodeSqlite } from "./sqlite.js";
import { loadSqliteVecExtension } from "./sqlite-vec.js";

const log = createSubsystemLogger("memory");

const TABLE = "deep_memory";

const vectorToBlob = (v: number[]): Buffer => Buffer.from(new Float32Array(v).buffer);

export class SqliteDeepMemoryProvider {
  private db: import("node:sqlite").DatabaseSync | null = null;
  private vecAvailable = false;

  constructor(
    private readonly dbPath: string,
    private readonly vectorDim: number,
  ) {}

  private ensureDb(): import("node:sqlite").DatabaseSync {
    if (this.db) return this.db;

    const { DatabaseSync } = requireNodeSqlite();
    ensureDir(path.dirname(this.dbPath));
    const dbFile = this.dbPath.endsWith(".sqlite") ? this.dbPath : `${this.dbPath}.sqlite`;
    this.db = new DatabaseSync(dbFile);

    // Create schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        source_file TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'other',
        importance REAL NOT NULL DEFAULT 1.0,
        createdAt INTEGER NOT NULL,
        embedding TEXT NOT NULL DEFAULT '[]'
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_category ON ${TABLE}(category)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_role ON ${TABLE}(role)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_created ON ${TABLE}(createdAt DESC)`);

    // Try loading sqlite-vec for vector search
    const vecResult = loadSqliteVecExtension({ db: this.db });
    // loadSqliteVecExtension is async but we need sync init — handle via promise
    void (async () => {
      const r = await vecResult;
      if (r.ok) {
        this.vecAvailable = true;
        try {
          this.db!.exec(
            `CREATE VIRTUAL TABLE IF NOT EXISTS ${TABLE}_vec USING vec0(id TEXT PRIMARY KEY, embedding float[${this.vectorDim}])`,
          );
        } catch {
          // Table might already exist with different dims — that's fine
        }
        log.debug("SqliteDeepMemory: sqlite-vec loaded for vector search");
      } else {
        log.debug(`SqliteDeepMemory: sqlite-vec unavailable (${r.error}), using cosine fallback`);
      }
    })();

    return this.db;
  }

  async store(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "importance"> & { importance?: number },
  ): Promise<MemoryEntry> {
    const db = this.ensureDb();
    const full: MemoryEntry = {
      ...entry,
      id: randomUUID(),
      importance: entry.importance ?? 1.0,
      createdAt: Date.now(),
    };

    db.prepare(
      `INSERT INTO ${TABLE} (id, role, text, source_file, category, importance, createdAt, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      full.id,
      full.role,
      full.text,
      full.source_file,
      full.category,
      full.importance,
      full.createdAt,
      JSON.stringify(full.vector),
    );

    if (this.vecAvailable && full.vector.length === this.vectorDim) {
      try {
        db.prepare(`INSERT INTO ${TABLE}_vec (id, embedding) VALUES (?, ?)`).run(
          full.id,
          vectorToBlob(full.vector),
        );
      } catch {}
    }

    return full;
  }

  async storeBatch(
    entries: Array<Omit<MemoryEntry, "id" | "createdAt" | "importance"> & { importance?: number }>,
  ): Promise<MemoryEntry[]> {
    if (entries.length === 0) return [];
    const results: MemoryEntry[] = [];
    for (const entry of entries) {
      results.push(await this.store(entry));
    }
    return results;
  }

  async search(
    vector: number[],
    limit = 5,
    options?: { minScore?: number; role?: string; category?: MemoryCategory },
  ): Promise<LanceDbSearchResult[]> {
    const db = this.ensureDb();
    const minScore = options?.minScore ?? 0.0;

    // Try sqlite-vec first
    if (this.vecAvailable && vector.length === this.vectorDim) {
      try {
        // Build filter
        const filters: string[] = [];
        const params: SQLInputValue[] = [];

        if (options?.role) {
          filters.push(`d.role = ?`);
          params.push(options.role);
        }
        if (options?.category) {
          filters.push(`d.category = ?`);
          params.push(options.category);
        }

        const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

        const allParams: SQLInputValue[] = [
          vectorToBlob(vector) as unknown as SQLInputValue,
          ...params,
          limit,
        ];

        const rows = db
          .prepare(
            `SELECT d.*, vec_distance_cosine(v.embedding, ?) AS dist
           FROM ${TABLE}_vec v
           JOIN ${TABLE} d ON d.id = v.id
           ${whereClause}
           ORDER BY dist ASC
           LIMIT ?`,
          )
          .all(...allParams) as Array<{
          id: string;
          role: string;
          text: string;
          source_file: string;
          category: string;
          importance: number;
          createdAt: number;
          embedding: string;
          dist: number;
        }>;

        return rows
          .map((r) => ({
            entry: {
              id: r.id,
              role: r.role as MemoryEntry["role"],
              text: r.text,
              vector: [], // Don't deserialize vector for search results
              source_file: r.source_file,
              category: r.category as MemoryCategory,
              importance: r.importance,
              createdAt: r.createdAt,
            },
            score: 1 / (1 + r.dist),
          }))
          .filter((r) => r.score >= minScore);
      } catch (err) {
        log.debug(`SqliteDeepMemory vec search failed, falling back: ${String(err)}`);
      }
    }

    // Fallback: brute-force cosine similarity
    const filters: string[] = [];
    const params: SQLInputValue[] = [];
    if (options?.role) {
      filters.push(`role = ?`);
      params.push(options.role);
    }
    if (options?.category) {
      filters.push(`category = ?`);
      params.push(options.category);
    }
    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const allParams: SQLInputValue[] = [...params, limit * 3];

    const rows = db
      .prepare(`SELECT * FROM ${TABLE} ${whereClause} ORDER BY createdAt DESC LIMIT ?`)
      .all(...allParams) as Array<{
      id: string;
      role: string;
      text: string;
      source_file: string;
      category: string;
      importance: number;
      createdAt: number;
      embedding: string;
    }>;

    const scored = rows.map((r) => {
      const emb = JSON.parse(r.embedding) as number[];
      const score = emb.length > 0 && vector.length > 0 ? cosine(vector, emb) : 0;
      return {
        entry: {
          id: r.id,
          role: r.role as MemoryEntry["role"],
          text: r.text,
          vector: [],
          source_file: r.source_file,
          category: r.category as MemoryCategory,
          importance: r.importance,
          createdAt: r.createdAt,
        },
        score,
      };
    });

    return scored
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async count(): Promise<number> {
    const db = this.ensureDb();
    const row = db.prepare(`SELECT COUNT(*) as c FROM ${TABLE}`).get() as { c: number } | undefined;
    return row?.c ?? 0;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0,
    nA = 0,
    nB = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0,
      bv = b[i] ?? 0;
    dot += av * bv;
    nA += av * av;
    nB += bv * bv;
  }
  return nA === 0 || nB === 0 ? 0 : dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

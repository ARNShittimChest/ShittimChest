import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type FSWatcher } from "chokidar";
import { resolveAgentDir, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { ResolvedMemorySearchConfig } from "../agents/memory-search.js";
import { resolveMemorySearchConfig } from "../agents/memory-search.js";
import { SenseiProfiler } from "../agents/sensei-profiler.js";
import { runMemoryReflection } from "../agents/memory-reflect.js";
import type { ShittimChestConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  createEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingProviderResult,
  type GeminiEmbeddingClient,
  type MistralEmbeddingClient,
  type OpenAiEmbeddingClient,
  type VoyageEmbeddingClient,
} from "./embeddings.js";
import { isFileMissingError, statRegularFile } from "./fs-utils.js";
import { bm25RankToScore, buildFtsQuery, mergeHybridResults } from "./hybrid.js";
import { isMemoryPath, normalizeExtraMemoryPaths } from "./internal.js";
import { LanceDbProvider } from "./lancedb-provider.js";
import { MemoryManagerEmbeddingOps } from "./manager-embedding-ops.js";
import { searchKeyword, searchVector } from "./manager-search.js";
import { extractKeywords } from "./query-expansion.js";
import type {
  MemoryEmbeddingProbeResult,
  MemoryProviderStatus,
  MemorySearchManager,
  MemorySearchResult,
  MemorySource,
  MemorySyncProgressUpdate,
} from "./types.js";
const SNIPPET_MAX_CHARS = 700;
const VECTOR_TABLE = "chunks_vec";
const FTS_TABLE = "chunks_fts";
const EMBEDDING_CACHE_TABLE = "embedding_cache";
const BATCH_FAILURE_LIMIT = 2;

const log = createSubsystemLogger("memory");

const INDEX_CACHE = new Map<string, MemoryIndexManager>();
const INDEX_CACHE_PENDING = new Map<string, Promise<MemoryIndexManager>>();

export class MemoryIndexManager extends MemoryManagerEmbeddingOps implements MemorySearchManager {
  private readonly cacheKey: string;
  protected readonly cfg: ShittimChestConfig;
  protected readonly agentId: string;
  protected readonly workspaceDir: string;
  protected readonly settings: ResolvedMemorySearchConfig;
  protected provider: EmbeddingProvider | null;
  private readonly requestedProvider: "openai" | "local" | "gemini" | "voyage" | "mistral" | "auto";
  protected fallbackFrom?: "openai" | "local" | "gemini" | "voyage" | "mistral";
  protected fallbackReason?: string;
  private readonly providerUnavailableReason?: string;
  protected openAi?: OpenAiEmbeddingClient;
  protected gemini?: GeminiEmbeddingClient;
  protected voyage?: VoyageEmbeddingClient;
  protected mistral?: MistralEmbeddingClient;
  protected batch: {
    enabled: boolean;
    wait: boolean;
    concurrency: number;
    pollIntervalMs: number;
    timeoutMs: number;
  };
  protected batchFailureCount = 0;
  protected batchFailureLastError?: string;
  protected batchFailureLastProvider?: string;
  protected batchFailureLock: Promise<void> = Promise.resolve();
  protected db: DatabaseSync;
  protected readonly sources: Set<MemorySource>;
  protected providerKey: string;
  protected readonly cache: { enabled: boolean; maxEntries?: number };
  protected readonly vector: {
    enabled: boolean;
    available: boolean | null;
    extensionPath?: string;
    loadError?: string;
    dims?: number;
  };
  protected readonly fts: {
    enabled: boolean;
    available: boolean;
    loadError?: string;
  };
  protected vectorReady: Promise<boolean> | null = null;
  protected watcher: FSWatcher | null = null;
  protected watchTimer: NodeJS.Timeout | null = null;
  protected sessionWatchTimer: NodeJS.Timeout | null = null;
  protected sessionUnsubscribe: (() => void) | null = null;
  protected intervalTimer: NodeJS.Timeout | null = null;
  protected closed = false;
  protected dirty = false;
  protected sessionsDirty = false;
  protected sessionsDirtyFiles = new Set<string>();
  protected sessionPendingFiles = new Set<string>();
  protected sessionDeltas = new Map<
    string,
    { lastSize: number; pendingBytes: number; pendingMessages: number }
  >();
  private sessionWarm = new Set<string>();
  private syncing: Promise<void> | null = null;
  private readonlyRecoveryAttempts = 0;
  private readonlyRecoverySuccesses = 0;
  private readonlyRecoveryFailures = 0;
  private readonlyRecoveryLastError?: string;
  // Deep Memory (LanceDB) fields — initialized lazily, fire-and-forget
  private lanceDb: LanceDbProvider | null = null;
  private lanceDbReady: Promise<void> | null = null;
  private senseiProfiler: SenseiProfiler | null = null;
  private reflectTimer: NodeJS.Timeout | null = null;

  static async get(params: {
    cfg: ShittimChestConfig;
    agentId: string;
    purpose?: "default" | "status";
  }): Promise<MemoryIndexManager | null> {
    const { cfg, agentId } = params;
    const settings = resolveMemorySearchConfig(cfg, agentId);
    if (!settings) {
      return null;
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const key = `${agentId}:${workspaceDir}:${JSON.stringify(settings)}`;
    const existing = INDEX_CACHE.get(key);
    if (existing) {
      return existing;
    }
    const pending = INDEX_CACHE_PENDING.get(key);
    if (pending) {
      return pending;
    }
    const createPromise = (async () => {
      const providerResult = await createEmbeddingProvider({
        config: cfg,
        agentDir: resolveAgentDir(cfg, agentId),
        provider: settings.provider,
        remote: settings.remote,
        model: settings.model,
        fallback: settings.fallback,
        local: settings.local,
      });
      const refreshed = INDEX_CACHE.get(key);
      if (refreshed) {
        return refreshed;
      }
      const manager = new MemoryIndexManager({
        cacheKey: key,
        cfg,
        agentId,
        workspaceDir,
        settings,
        providerResult,
        purpose: params.purpose,
      });
      INDEX_CACHE.set(key, manager);
      return manager;
    })();
    INDEX_CACHE_PENDING.set(key, createPromise);
    try {
      return await createPromise;
    } finally {
      if (INDEX_CACHE_PENDING.get(key) === createPromise) {
        INDEX_CACHE_PENDING.delete(key);
      }
    }
  }

  private constructor(params: {
    cacheKey: string;
    cfg: ShittimChestConfig;
    agentId: string;
    workspaceDir: string;
    settings: ResolvedMemorySearchConfig;
    providerResult: EmbeddingProviderResult;
    purpose?: "default" | "status";
  }) {
    super();
    this.cacheKey = params.cacheKey;
    this.cfg = params.cfg;
    this.agentId = params.agentId;
    this.workspaceDir = params.workspaceDir;
    this.settings = params.settings;
    this.provider = params.providerResult.provider;
    this.requestedProvider = params.providerResult.requestedProvider;
    this.fallbackFrom = params.providerResult.fallbackFrom;
    this.fallbackReason = params.providerResult.fallbackReason;
    this.providerUnavailableReason = params.providerResult.providerUnavailableReason;
    this.openAi = params.providerResult.openAi;
    this.gemini = params.providerResult.gemini;
    this.voyage = params.providerResult.voyage;
    this.mistral = params.providerResult.mistral;
    this.sources = new Set(params.settings.sources);
    this.db = this.openDatabase();
    this.providerKey = this.computeProviderKey();
    this.cache = {
      enabled: params.settings.cache.enabled,
      maxEntries: params.settings.cache.maxEntries,
    };
    this.fts = { enabled: params.settings.query.hybrid.enabled, available: false };
    this.ensureSchema();
    this.vector = {
      enabled: params.settings.store.vector.enabled,
      available: null,
      extensionPath: params.settings.store.vector.extensionPath,
    };
    const meta = this.readMeta();
    if (meta?.vectorDims) {
      this.vector.dims = meta.vectorDims;
    }
    this.ensureWatcher();
    this.ensureSessionListener();
    this.ensureIntervalSync();
    const statusOnly = params.purpose === "status";
    this.dirty = this.sources.has("memory") && (statusOnly ? !meta : true);
    this.batch = this.resolveBatchConfig();
    // Deep Memory: initialize LanceDB and SenseiProfiler if configured
    this.initLanceDb();
  }

  /** Resolve the default LanceDB storage path: ~/.shittimchest/memory/lancedb */
  private resolveLanceDbPath(): string {
    const configured = this.cfg.memory?.lancedb?.storagePath;
    if (configured) return configured;
    return path.join(os.homedir(), ".shittimchest", "memory", "lancedb");
  }

  /**
   * Initialize LanceDB provider and SenseiProfiler asynchronously.
   * LanceDB is ALWAYS ON by default — only skipped when explicitly disabled via
   * `memory.lancedb.logFullConversation: false`.
   * This is fire-and-forget — failures are logged but never bubble up.
   */
  private initLanceDb(): void {
    const lancedbCfg = this.cfg.memory?.lancedb;
    // Only skip if user has explicitly set logFullConversation to false
    if (lancedbCfg?.logFullConversation === false) {
      log.debug("LanceDB deep memory disabled via config (logFullConversation: false)");
      return;
    }

    const dbPath = this.resolveLanceDbPath();
    // Vector dim: use provider dim if known, else default 1536 (text-embedding-3-small)
    const vectorDim = this.vector.dims ?? 1536;
    this.lanceDb = new LanceDbProvider(dbPath, vectorDim);

    // Kick off async init (connect + create table) in background
    this.lanceDbReady = (async () => {
      try {
        // Trigger a benign operation to ensure table is created before first write
        await this.lanceDb!.count();
        log.debug("LanceDB initialized for deep memory");
      } catch (err) {
        log.warn(`LanceDB init failed: ${String(err)}`);
        this.lanceDb = null;
      }
    })();

    // Initialize SenseiProfiler unless explicitly disabled
    if (lancedbCfg?.profileSensei?.enabled !== false) {
      this.senseiProfiler = new SenseiProfiler(this.cfg, this.agentId, this);
    }

    // Schedule nightly reflection (default: 3am daily ≈ every 24h)
    this.ensureReflectJob();
  }

  /** Schedule the memory reflection job. Uses a simple 24h interval for MVP. */
  private ensureReflectJob(): void {
    // Run once 24h after startup, then repeat every 24h
    const MS_24H = 24 * 60 * 60 * 1000;
    this.reflectTimer = setInterval(() => {
      runMemoryReflection(this.cfg, this.agentId).catch((err) => {
        log.warn(`Memory reflection failed: ${String(err)}`);
      });
    }, MS_24H);
    // Unref so it doesn't keep Node alive
    this.reflectTimer.unref();
  }

  /** Return the active LanceDbProvider, or null if not initialized. */
  getLanceDbProvider(): LanceDbProvider | null {
    return this.lanceDb;
  }

  /** Return the active embedding provider (same one used by SQLite search). */
  getEmbeddingProvider(): EmbeddingProvider | null {
    return this.provider;
  }

  /**
   * Record a single chat turn into LanceDB (fire-and-forget).
   * Safe to call on every message; silently skips if LanceDB is not enabled.
   */
  recordChatTurn(role: "user" | "assistant" | "system", text: string): void {
    if (!this.lanceDb || !text.trim()) return;

    // Add user messages to SenseiProfiler buffer (batched background analysis)
    if (role === "user" && this.senseiProfiler) {
      this.senseiProfiler.addMessage(text);
    }

    void (async () => {
      try {
        // Wait for LanceDB to be ready before first write
        if (this.lanceDbReady) await this.lanceDbReady;
        if (!this.lanceDb) return;

        const embeddingProvider = this.provider;
        const vector = embeddingProvider
          ? await embeddingProvider.embedQuery(text).catch(() => [])
          : [];

        await this.lanceDb.store({
          role,
          text,
          vector,
          source_file: `chat/${this.agentId}`,
          category: "chat_log",
          // User messages get slightly higher importance for profiling
          importance: role === "user" ? 1.2 : 1.0,
        });
      } catch (err) {
        log.debug(`LanceDB chat turn recording failed: ${String(err)}`);
      }
    })();
  }

  async warmSession(sessionKey?: string): Promise<void> {
    if (!this.settings.sync.onSessionStart) {
      return;
    }
    const key = sessionKey?.trim() || "";
    if (key && this.sessionWarm.has(key)) {
      return;
    }
    void this.sync({ reason: "session-start" }).catch((err) => {
      log.warn(`memory sync failed (session-start): ${String(err)}`);
    });
    if (key) {
      this.sessionWarm.add(key);
    }
  }

  async search(
    query: string,
    opts?: {
      maxResults?: number;
      minScore?: number;
      sessionKey?: string;
    },
  ): Promise<MemorySearchResult[]> {
    void this.warmSession(opts?.sessionKey);
    if (this.settings.sync.onSearch && (this.dirty || this.sessionsDirty)) {
      void this.sync({ reason: "search" }).catch((err) => {
        log.warn(`memory sync failed (search): ${String(err)}`);
      });
    }
    const cleaned = query.trim();
    if (!cleaned) {
      return [];
    }
    const minScore = opts?.minScore ?? this.settings.query.minScore;
    const maxResults = opts?.maxResults ?? this.settings.query.maxResults;
    const hybrid = this.settings.query.hybrid;
    const candidates = Math.min(
      200,
      Math.max(1, Math.floor(maxResults * hybrid.candidateMultiplier)),
    );

    // FTS-only mode: no embedding provider available
    if (!this.provider) {
      if (!this.fts.enabled || !this.fts.available) {
        log.warn("memory search: no provider and FTS unavailable");
        return [];
      }

      // Extract keywords for better FTS matching on conversational queries
      // e.g., "that thing we discussed about the API" → ["discussed", "API"]
      const keywords = extractKeywords(cleaned);
      const searchTerms = keywords.length > 0 ? keywords : [cleaned];

      // Search with each keyword and merge results
      const resultSets = await Promise.all(
        searchTerms.map((term) => this.searchKeyword(term, candidates).catch(() => [])),
      );

      // Merge and deduplicate results, keeping highest score for each chunk
      const seenIds = new Map<string, (typeof resultSets)[0][0]>();
      for (const results of resultSets) {
        for (const result of results) {
          const existing = seenIds.get(result.id);
          if (!existing || result.score > existing.score) {
            seenIds.set(result.id, result);
          }
        }
      }

      const merged = [...seenIds.values()]
        .toSorted((a, b) => b.score - a.score)
        .filter((entry) => entry.score >= minScore)
        .slice(0, maxResults);

      return merged;
    }

    const keywordResults = hybrid.enabled
      ? await this.searchKeyword(cleaned, candidates).catch(() => [])
      : [];

    const queryVec = await this.embedQueryWithTimeout(cleaned);
    const hasVector = queryVec.some((v) => v !== 0);
    const vectorResults = hasVector
      ? await this.searchVector(queryVec, candidates).catch(() => [])
      : [];

    if (!hybrid.enabled) {
      return vectorResults.filter((entry) => entry.score >= minScore).slice(0, maxResults);
    }

    const merged = await this.mergeHybridResults({
      vector: vectorResults,
      keyword: keywordResults,
      vectorWeight: hybrid.vectorWeight,
      textWeight: hybrid.textWeight,
      mmr: hybrid.mmr,
      temporalDecay: hybrid.temporalDecay,
    });
    const strict = merged.filter((entry) => entry.score >= minScore);
    if (strict.length > 0 || keywordResults.length === 0) {
      return strict.slice(0, maxResults);
    }

    // Hybrid defaults can produce keyword-only matches with max score equal to
    // textWeight (for example 0.3). If minScore is higher (for example 0.35),
    // these exact lexical hits get filtered out even when they are the only
    // relevant results.
    const relaxedMinScore = Math.min(minScore, hybrid.textWeight);
    const keywordKeys = new Set(
      keywordResults.map(
        (entry) => `${entry.source}:${entry.path}:${entry.startLine}:${entry.endLine}`,
      ),
    );
    return merged
      .filter(
        (entry) =>
          keywordKeys.has(`${entry.source}:${entry.path}:${entry.startLine}:${entry.endLine}`) &&
          entry.score >= relaxedMinScore,
      )
      .slice(0, maxResults);
  }

  private async searchVector(
    queryVec: number[],
    limit: number,
  ): Promise<Array<MemorySearchResult & { id: string }>> {
    // This method should never be called without a provider
    if (!this.provider) {
      return [];
    }
    const results = await searchVector({
      db: this.db,
      vectorTable: VECTOR_TABLE,
      providerModel: this.provider.model,
      queryVec,
      limit,
      snippetMaxChars: SNIPPET_MAX_CHARS,
      ensureVectorReady: async (dimensions) => await this.ensureVectorReady(dimensions),
      sourceFilterVec: this.buildSourceFilter("c"),
      sourceFilterChunks: this.buildSourceFilter(),
    });
    return results.map((entry) => entry as MemorySearchResult & { id: string });
  }

  private buildFtsQuery(raw: string): string | null {
    return buildFtsQuery(raw);
  }

  private async searchKeyword(
    query: string,
    limit: number,
  ): Promise<Array<MemorySearchResult & { id: string; textScore: number }>> {
    if (!this.fts.enabled || !this.fts.available) {
      return [];
    }
    const sourceFilter = this.buildSourceFilter();
    // In FTS-only mode (no provider), search all models; otherwise filter by current provider's model
    const providerModel = this.provider?.model;
    const results = await searchKeyword({
      db: this.db,
      ftsTable: FTS_TABLE,
      providerModel,
      query,
      limit,
      snippetMaxChars: SNIPPET_MAX_CHARS,
      sourceFilter,
      buildFtsQuery: (raw) => this.buildFtsQuery(raw),
      bm25RankToScore,
    });
    return results.map((entry) => entry as MemorySearchResult & { id: string; textScore: number });
  }

  private mergeHybridResults(params: {
    vector: Array<MemorySearchResult & { id: string }>;
    keyword: Array<MemorySearchResult & { id: string; textScore: number }>;
    vectorWeight: number;
    textWeight: number;
    mmr?: { enabled: boolean; lambda: number };
    temporalDecay?: { enabled: boolean; halfLifeDays: number };
  }): Promise<MemorySearchResult[]> {
    return mergeHybridResults({
      vector: params.vector.map((r) => ({
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        vectorScore: r.score,
      })),
      keyword: params.keyword.map((r) => ({
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        textScore: r.textScore,
      })),
      vectorWeight: params.vectorWeight,
      textWeight: params.textWeight,
      mmr: params.mmr,
      temporalDecay: params.temporalDecay,
      workspaceDir: this.workspaceDir,
    }).then((entries) => entries.map((entry) => entry as MemorySearchResult));
  }

  async sync(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.syncing) {
      return this.syncing;
    }
    this.syncing = this.runSyncWithReadonlyRecovery(params).finally(() => {
      this.syncing = null;
    });
    return this.syncing ?? Promise.resolve();
  }

  private isReadonlyDbError(err: unknown): boolean {
    const readonlyPattern =
      /attempt to write a readonly database|database is read-only|SQLITE_READONLY/i;
    const messages = new Set<string>();

    const pushValue = (value: unknown): void => {
      if (typeof value !== "string") {
        return;
      }
      const normalized = value.trim();
      if (!normalized) {
        return;
      }
      messages.add(normalized);
    };

    pushValue(err instanceof Error ? err.message : String(err));
    if (err && typeof err === "object") {
      const record = err as Record<string, unknown>;
      pushValue(record.message);
      pushValue(record.code);
      pushValue(record.name);
      if (record.cause && typeof record.cause === "object") {
        const cause = record.cause as Record<string, unknown>;
        pushValue(cause.message);
        pushValue(cause.code);
        pushValue(cause.name);
      }
    }

    return [...messages].some((value) => readonlyPattern.test(value));
  }

  private extractErrorReason(err: unknown): string {
    if (err instanceof Error && err.message.trim()) {
      return err.message;
    }
    if (err && typeof err === "object") {
      const record = err as Record<string, unknown>;
      if (typeof record.message === "string" && record.message.trim()) {
        return record.message;
      }
      if (typeof record.code === "string" && record.code.trim()) {
        return record.code;
      }
    }
    return String(err);
  }

  private async runSyncWithReadonlyRecovery(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void> {
    try {
      await this.runSync(params);
      return;
    } catch (err) {
      if (!this.isReadonlyDbError(err) || this.closed) {
        throw err;
      }
      const reason = this.extractErrorReason(err);
      this.readonlyRecoveryAttempts += 1;
      this.readonlyRecoveryLastError = reason;
      log.warn(`memory sync readonly handle detected; reopening sqlite connection`, { reason });
      try {
        this.db.close();
      } catch {}
      this.db = this.openDatabase();
      this.vectorReady = null;
      this.vector.available = null;
      this.vector.loadError = undefined;
      this.ensureSchema();
      const meta = this.readMeta();
      this.vector.dims = meta?.vectorDims;
      try {
        await this.runSync(params);
        this.readonlyRecoverySuccesses += 1;
      } catch (retryErr) {
        this.readonlyRecoveryFailures += 1;
        throw retryErr;
      }
    }
  }

  async readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }> {
    const rawPath = params.relPath.trim();
    if (!rawPath) {
      throw new Error("path required");
    }
    const absPath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(this.workspaceDir, rawPath);
    const relPath = path.relative(this.workspaceDir, absPath).replace(/\\/g, "/");
    const inWorkspace =
      relPath.length > 0 && !relPath.startsWith("..") && !path.isAbsolute(relPath);
    const allowedWorkspace = inWorkspace && isMemoryPath(relPath);
    let allowedAdditional = false;
    if (!allowedWorkspace && this.settings.extraPaths.length > 0) {
      const additionalPaths = normalizeExtraMemoryPaths(
        this.workspaceDir,
        this.settings.extraPaths,
      );
      for (const additionalPath of additionalPaths) {
        try {
          const stat = await fs.lstat(additionalPath);
          if (stat.isSymbolicLink()) {
            continue;
          }
          if (stat.isDirectory()) {
            if (absPath === additionalPath || absPath.startsWith(`${additionalPath}${path.sep}`)) {
              allowedAdditional = true;
              break;
            }
            continue;
          }
          if (stat.isFile()) {
            if (absPath === additionalPath && absPath.endsWith(".md")) {
              allowedAdditional = true;
              break;
            }
          }
        } catch {}
      }
    }
    if (!allowedWorkspace && !allowedAdditional) {
      throw new Error("path required");
    }
    if (!absPath.endsWith(".md")) {
      throw new Error("path required");
    }
    const statResult = await statRegularFile(absPath);
    if (statResult.missing) {
      return { text: "", path: relPath };
    }
    let content: string;
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch (err) {
      if (isFileMissingError(err)) {
        return { text: "", path: relPath };
      }
      throw err;
    }
    if (!params.from && !params.lines) {
      return { text: content, path: relPath };
    }
    const lines = content.split("\n");
    const start = Math.max(1, params.from ?? 1);
    const count = Math.max(1, params.lines ?? lines.length);
    const slice = lines.slice(start - 1, start - 1 + count);
    return { text: slice.join("\n"), path: relPath };
  }

  status(): MemoryProviderStatus {
    const sourceFilter = this.buildSourceFilter();
    const files = this.db
      .prepare(`SELECT COUNT(*) as c FROM files WHERE 1=1${sourceFilter.sql}`)
      .get(...sourceFilter.params) as {
      c: number;
    };
    const chunks = this.db
      .prepare(`SELECT COUNT(*) as c FROM chunks WHERE 1=1${sourceFilter.sql}`)
      .get(...sourceFilter.params) as {
      c: number;
    };
    const sourceCounts = (() => {
      const sources = Array.from(this.sources);
      if (sources.length === 0) {
        return [];
      }
      const bySource = new Map<MemorySource, { files: number; chunks: number }>();
      for (const source of sources) {
        bySource.set(source, { files: 0, chunks: 0 });
      }
      const fileRows = this.db
        .prepare(
          `SELECT source, COUNT(*) as c FROM files WHERE 1=1${sourceFilter.sql} GROUP BY source`,
        )
        .all(...sourceFilter.params) as Array<{ source: MemorySource; c: number }>;
      for (const row of fileRows) {
        const entry = bySource.get(row.source) ?? { files: 0, chunks: 0 };
        entry.files = row.c ?? 0;
        bySource.set(row.source, entry);
      }
      const chunkRows = this.db
        .prepare(
          `SELECT source, COUNT(*) as c FROM chunks WHERE 1=1${sourceFilter.sql} GROUP BY source`,
        )
        .all(...sourceFilter.params) as Array<{ source: MemorySource; c: number }>;
      for (const row of chunkRows) {
        const entry = bySource.get(row.source) ?? { files: 0, chunks: 0 };
        entry.chunks = row.c ?? 0;
        bySource.set(row.source, entry);
      }
      return sources.map((source) => Object.assign({ source }, bySource.get(source)!));
    })();

    // Determine search mode: "fts-only" if no provider, "hybrid" otherwise
    const searchMode = this.provider ? "hybrid" : "fts-only";
    const providerInfo = this.provider
      ? { provider: this.provider.id, model: this.provider.model }
      : { provider: "none", model: undefined };

    return {
      backend: "builtin",
      files: files?.c ?? 0,
      chunks: chunks?.c ?? 0,
      dirty: this.dirty || this.sessionsDirty,
      workspaceDir: this.workspaceDir,
      dbPath: this.settings.store.path,
      provider: providerInfo.provider,
      model: providerInfo.model,
      requestedProvider: this.requestedProvider,
      sources: Array.from(this.sources),
      extraPaths: this.settings.extraPaths,
      sourceCounts,
      cache: this.cache.enabled
        ? {
            enabled: true,
            entries:
              (
                this.db.prepare(`SELECT COUNT(*) as c FROM ${EMBEDDING_CACHE_TABLE}`).get() as
                  | { c: number }
                  | undefined
              )?.c ?? 0,
            maxEntries: this.cache.maxEntries,
          }
        : { enabled: false, maxEntries: this.cache.maxEntries },
      fts: {
        enabled: this.fts.enabled,
        available: this.fts.available,
        error: this.fts.loadError,
      },
      fallback: this.fallbackReason
        ? { from: this.fallbackFrom ?? "local", reason: this.fallbackReason }
        : undefined,
      vector: {
        enabled: this.vector.enabled,
        available: this.vector.available ?? undefined,
        extensionPath: this.vector.extensionPath,
        loadError: this.vector.loadError,
        dims: this.vector.dims,
      },
      batch: {
        enabled: this.batch.enabled,
        failures: this.batchFailureCount,
        limit: BATCH_FAILURE_LIMIT,
        wait: this.batch.wait,
        concurrency: this.batch.concurrency,
        pollIntervalMs: this.batch.pollIntervalMs,
        timeoutMs: this.batch.timeoutMs,
        lastError: this.batchFailureLastError,
        lastProvider: this.batchFailureLastProvider,
      },
      custom: {
        searchMode,
        providerUnavailableReason: this.providerUnavailableReason,
        readonlyRecovery: {
          attempts: this.readonlyRecoveryAttempts,
          successes: this.readonlyRecoverySuccesses,
          failures: this.readonlyRecoveryFailures,
          lastError: this.readonlyRecoveryLastError,
        },
      },
    };
  }

  async probeVectorAvailability(): Promise<boolean> {
    // FTS-only mode: vector search not available
    if (!this.provider) {
      return false;
    }
    if (!this.vector.enabled) {
      return false;
    }
    return this.ensureVectorReady();
  }

  async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
    // FTS-only mode: embeddings not available but search still works
    if (!this.provider) {
      return {
        ok: false,
        error: this.providerUnavailableReason ?? "No embedding provider available (FTS-only mode)",
      };
    }
    try {
      await this.embedBatchWithRetry(["ping"]);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const pendingSync = this.syncing;
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = null;
    }
    if (this.sessionWatchTimer) {
      clearTimeout(this.sessionWatchTimer);
      this.sessionWatchTimer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.reflectTimer) {
      clearInterval(this.reflectTimer);
      this.reflectTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    if (this.sessionUnsubscribe) {
      this.sessionUnsubscribe();
      this.sessionUnsubscribe = null;
    }
    if (pendingSync) {
      try {
        await pendingSync;
      } catch {}
    }
    if (this.lanceDb) {
      await this.lanceDb.close().catch(() => {});
      this.lanceDb = null;
    }
    this.db.close();
    INDEX_CACHE.delete(this.cacheKey);
  }
}

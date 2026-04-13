/**
 * arona/habits/habit-tracker.ts
 *
 * Core engine for learning Sensei's sleep/wake cycle from chat activity.
 *
 * Records when Sensei sends messages, builds a 24-hour activity histogram,
 * runs the Longest Quiet Gap algorithm to detect sleep/wake times, and
 * resolves the final schedule using the priority chain:
 *   explicit user override > learned pattern (confidence >= 0.5) > defaults
 *
 * Storage: `.arona/user-habits.json` (atomic write — tmp file + rename).
 */

import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  type ActivityRecord,
  type LearnedSchedule,
  type ExplicitSchedule,
  type HabitData,
  type ResolvedSchedule,
  DEFAULT_SCHEDULE,
  ACTIVITY_RETENTION_DAYS,
  MIN_SLEEP_GAP_HOURS,
  MIN_LEARNED_CONFIDENCE,
  HYSTERESIS_HOURS,
  HYSTERESIS_CONFIDENCE_DELTA,
} from "./types.js";

const log = createSubsystemLogger("habit-tracker");

// ── Singleton ───────────────────────────────────────────────────

let instance: HabitTracker | null = null;

/** Get the global HabitTracker instance (null if not initialized). */
export function getHabitTracker(): HabitTracker | null {
  return instance;
}

// ── HabitTracker Class ──────────────────────────────────────────

export class HabitTracker {
  private data: HabitData;
  private filePath: string;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Debounce interval for persisting to disk (ms). */
  private static readonly SAVE_DEBOUNCE_MS = 30_000;

  /** Minimum messages before running analysis. */
  private static readonly MIN_RECORDS_FOR_ANALYSIS = 20;

  /** Re-analyze after this many new records since last analysis. */
  private static readonly REANALYZE_THRESHOLD = 15;

  /** Track records added since last analysis for re-analysis triggering. */
  private recordsSinceAnalysis = 0;

  constructor(workspaceDir: string) {
    this.filePath = path.join(workspaceDir, ".arona", "user-habits.json");
    this.data = this.loadFromDisk();
    instance = this;
    log.debug(`Initialized — ${this.data.recentActivity.length} activity records loaded`);
  }

  // ── Activity Recording ──────────────────────────────────────

  /** Record a chat activity from Sensei. */
  recordActivity(timestampMs?: number): void {
    const ts = timestampMs ?? Date.now();
    const hour = new Date(ts).getHours();

    this.data.recentActivity.push({ timestampMs: ts, hour });
    this.pruneOldRecords();
    this.dirty = true;
    this.scheduleSave();

    this.recordsSinceAnalysis++;

    // Auto-analyze when enough new data accumulates
    if (
      this.recordsSinceAnalysis >= HabitTracker.REANALYZE_THRESHOLD &&
      this.data.recentActivity.length >= HabitTracker.MIN_RECORDS_FOR_ANALYSIS
    ) {
      this.analyzeSchedule();
    }
  }

  /** Remove records older than the retention window. */
  private pruneOldRecords(): void {
    const cutoff = Date.now() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    this.data.recentActivity = this.data.recentActivity.filter((r) => r.timestampMs >= cutoff);
  }

  // ── Schedule Analysis (Longest Quiet Gap) ───────────────────

  /**
   * Run the Longest Quiet Gap algorithm on recent activity data.
   * Updates `this.data.learned` if the result passes quality checks.
   */
  analyzeSchedule(): LearnedSchedule | null {
    const records = this.data.recentActivity;
    if (records.length < HabitTracker.MIN_RECORDS_FOR_ANALYSIS) {
      log.debug(
        `Not enough data for analysis (${records.length} records, need ${HabitTracker.MIN_RECORDS_FOR_ANALYSIS})`,
      );
      return this.data.learned;
    }

    this.recordsSinceAnalysis = 0;

    // Step 1: Build weighted 24-hour histogram
    const histogram = new Float64Array(24);
    const nowMs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const halfLifeDays = 7;

    for (const record of records) {
      const daysAgo = (nowMs - record.timestampMs) / dayMs;
      const weight = Math.pow(0.5, daysAgo / halfLifeDays);
      histogram[record.hour] += weight;
    }

    // Step 2: Normalize to [0, 1]
    const maxVal = Math.max(...histogram);
    if (maxVal === 0) return this.data.learned;
    const normalized = histogram.map((v) => v / maxVal);

    // Step 3: Find longest contiguous quiet window (circular)
    const QUIET_THRESHOLD = 0.1;
    let bestStart = -1;
    let bestLength = 0;

    for (let start = 0; start < 24; start++) {
      let length = 0;
      for (let offset = 0; offset < 24; offset++) {
        const hour = (start + offset) % 24;
        if (normalized[hour] < QUIET_THRESHOLD) {
          length++;
        } else {
          break;
        }
      }
      if (length > bestLength && length >= MIN_SLEEP_GAP_HOURS) {
        bestStart = start;
        bestLength = length;
      }
    }

    if (bestStart === -1) {
      log.debug("No clear sleep gap found in activity data");
      return this.data.learned;
    }

    // Step 4: Derive sleep/wake hours
    const sleepHour = bestStart;
    const wakeHour = (bestStart + bestLength) % 24;

    // Step 5: Calculate confidence
    const dataPointDays = this.countDistinctDays(records);
    const confidence = this.calculateConfidence(normalized, bestLength, dataPointDays);

    const newLearned: LearnedSchedule = {
      wakeHour,
      sleepHour,
      confidence,
      lastAnalyzedAt: new Date().toISOString(),
      dataPointDays,
    };

    // Step 6: Apply hysteresis — only update if meaningful change
    if (this.data.learned) {
      const hourDelta =
        Math.abs(newLearned.wakeHour - this.data.learned.wakeHour) +
        Math.abs(newLearned.sleepHour - this.data.learned.sleepHour);
      const confDelta = newLearned.confidence - this.data.learned.confidence;

      if (hourDelta < HYSTERESIS_HOURS && confDelta < HYSTERESIS_CONFIDENCE_DELTA) {
        log.debug(
          `Hysteresis: no update (hourDelta=${hourDelta.toFixed(1)}, confDelta=${confDelta.toFixed(2)})`,
        );
        return this.data.learned;
      }
    }

    log.info(
      `Schedule learned: wake=${wakeHour}h, sleep=${sleepHour}h, confidence=${confidence.toFixed(2)}, days=${dataPointDays}`,
    );

    this.data.learned = newLearned;
    this.dirty = true;
    this.scheduleSave();

    return newLearned;
  }

  /** Count distinct calendar days in the records. */
  private countDistinctDays(records: ActivityRecord[]): number {
    const days = new Set<string>();
    for (const r of records) {
      days.add(new Date(r.timestampMs).toDateString());
    }
    return days.size;
  }

  /** Calculate confidence based on data quantity, gap clarity, and consistency. */
  private calculateConfidence(
    normalized: Float64Array,
    gapLength: number,
    dataPointDays: number,
  ): number {
    // Factor 1: Data quantity (0-0.4)
    // More days = more confidence, capped at 7 days for full score
    const quantityScore = Math.min(dataPointDays / 7, 1) * 0.4;

    // Factor 2: Gap clarity (0-0.35)
    // Longer gap relative to total = clearer sleep pattern
    const clarityScore = (gapLength / 24) * 2 * 0.35; // 12h gap = max clarity

    // Factor 3: Contrast between active and quiet hours (0-0.25)
    let quietSum = 0;
    let activeSum = 0;
    let quietCount = 0;
    let activeCount = 0;
    for (let i = 0; i < 24; i++) {
      if (normalized[i] < 0.1) {
        quietSum += normalized[i];
        quietCount++;
      } else {
        activeSum += normalized[i];
        activeCount++;
      }
    }
    const quietAvg = quietCount > 0 ? quietSum / quietCount : 0;
    const activeAvg = activeCount > 0 ? activeSum / activeCount : 0;
    const contrastScore = Math.min((activeAvg - quietAvg) * 1.5, 1) * 0.25;

    let confidence = quantityScore + clarityScore + contrastScore;

    // Cap at 0.3 if less than 3 days of data
    if (dataPointDays < 3) {
      confidence = Math.min(confidence, 0.3);
    }

    return Math.max(0, Math.min(1, confidence));
  }

  // ── Explicit Schedule ───────────────────────────────────────

  /** Set explicit schedule override from user chat. */
  setExplicitSchedule(
    opts: { wakeHour?: number; sleepHour?: number },
    reason: string,
  ): ExplicitSchedule {
    const explicit: ExplicitSchedule = {
      ...this.data.explicit,
      ...opts,
      setAt: new Date().toISOString(),
      reason,
    };

    // Validate hours
    if (explicit.wakeHour !== undefined) {
      explicit.wakeHour = Math.max(0, Math.min(23, Math.round(explicit.wakeHour)));
    }
    if (explicit.sleepHour !== undefined) {
      explicit.sleepHour = Math.max(0, Math.min(23, Math.round(explicit.sleepHour)));
    }

    this.data.explicit = explicit;
    this.dirty = true;
    this.saveNow();

    log.info(
      `Explicit schedule set: wake=${explicit.wakeHour ?? "–"}, sleep=${explicit.sleepHour ?? "–"} (${reason})`,
    );

    return explicit;
  }

  /** Clear explicit override, falling back to learned or defaults. */
  clearExplicitSchedule(): void {
    this.data.explicit = null;
    this.dirty = true;
    this.saveNow();
    log.info("Explicit schedule cleared");
  }

  // ── Resolved Schedule ───────────────────────────────────────

  /** Get the final schedule using the priority chain. */
  getResolvedSchedule(): ResolvedSchedule {
    // Priority 1: Explicit override
    if (this.data.explicit) {
      const e = this.data.explicit;
      return {
        wakeHour: e.wakeHour ?? this.data.learned?.wakeHour ?? DEFAULT_SCHEDULE.wakeHour,
        sleepHour: e.sleepHour ?? this.data.learned?.sleepHour ?? DEFAULT_SCHEDULE.sleepHour,
        source: "explicit",
        confidence: 1,
      };
    }

    // Priority 2: Learned schedule (if confident enough)
    if (this.data.learned && this.data.learned.confidence >= MIN_LEARNED_CONFIDENCE) {
      return {
        wakeHour: this.data.learned.wakeHour,
        sleepHour: this.data.learned.sleepHour,
        source: "learned",
        confidence: this.data.learned.confidence,
      };
    }

    // Priority 3: Defaults
    return { ...DEFAULT_SCHEDULE };
  }

  // ── System Prompt Context ───────────────────────────────────

  /** Build a context string for injection into Arona's system prompt. */
  buildScheduleContext(): string | undefined {
    const schedule = this.getResolvedSchedule();
    if (schedule.source === "default") return undefined;

    const wakeStr = this.formatHour(schedule.wakeHour);
    const sleepStr = this.formatHour(schedule.sleepHour);

    const sourceHint =
      schedule.source === "explicit"
        ? "Sensei tu cho biet"
        : `Arona hoc tu activity patterns, do chinh xac ${Math.round(schedule.confidence * 100)}%`;

    const lines = [
      "## Gio giac cua Sensei",
      `Sensei thuong thuc day luc ${wakeStr} va di ngu luc ${sleepStr} (nguon: ${sourceHint}).`,
      "Arona da dieu chinh lich nhac nho va tin nhan theo gio giac nay.",
      "Neu Sensei muon thay doi, hay noi voi Arona.",
    ];

    return lines.join("\n");
  }

  /** Build a status summary for the schedule tool. */
  buildStatusSummary(): string {
    const schedule = this.getResolvedSchedule();
    const wakeStr = this.formatHour(schedule.wakeHour);
    const sleepStr = this.formatHour(schedule.sleepHour);

    const lines: string[] = [];
    lines.push(`Gio thuc day: ${wakeStr}`);
    lines.push(`Gio di ngu: ${sleepStr}`);

    if (schedule.source === "explicit") {
      lines.push(`Nguon: Sensei tu dat (${this.data.explicit?.reason ?? ""})`);
    } else if (schedule.source === "learned") {
      lines.push(
        `Nguon: Arona tu hoc (confidence ${Math.round(schedule.confidence * 100)}%, ${this.data.learned?.dataPointDays ?? 0} ngay du lieu)`,
      );
    } else {
      lines.push("Nguon: Mac dinh (chua co du lieu)");
    }

    lines.push(`Activity records: ${this.data.recentActivity.length}`);
    return lines.join("\n");
  }

  /** Get raw data for debugging. */
  getData(): Readonly<HabitData> {
    return this.data;
  }

  // ── Persistence ─────────────────────────────────────────────

  private loadFromDisk(): HabitData {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as HabitData;
      if (parsed.version === 1 && Array.isArray(parsed.recentActivity)) {
        // Prune on load
        const cutoff = Date.now() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        parsed.recentActivity = parsed.recentActivity.filter((r) => r.timestampMs >= cutoff);
        return parsed;
      }
    } catch {
      // File doesn't exist or corrupt — start fresh
    }
    return this.createEmpty();
  }

  private createEmpty(): HabitData {
    return {
      recentActivity: [],
      learned: null,
      explicit: null,
      version: 1,
    };
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, HabitTracker.SAVE_DEBOUNCE_MS);
  }

  private saveNow(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = `${this.filePath}.tmp-${process.pid}`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2) + "\n", "utf-8");
      fs.renameSync(tmpPath, this.filePath);
      this.dirty = false;
    } catch (err) {
      log.debug(`Failed to save habits: ${String(err)}`);
    }
  }

  /** Flush any pending data to disk (call on shutdown). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveNow();
  }

  // ── Helpers ─────────────────────────────────────────────────

  private formatHour(h: number): string {
    const hours = Math.floor(h);
    const minutes = Math.round((h - hours) * 60);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }
}

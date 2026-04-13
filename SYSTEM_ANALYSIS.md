# Arona-CLW: Config, Plugin & Tool Systems Analysis

## 1. src/config/config.ts

**Purpose:** Re-export hub for config system. Main config file is NOT this file—it's a barrel export.

**Key Exports:**

- Config I/O: `loadConfig`, `readConfigFileSnapshot`, `writeConfigFile`, `clearConfigCache`
- Validation: `validateConfigObject`, `validateConfigObjectWithPlugins`, `ShittimChestSchema`
- Legacy: `migrateLegacyConfig`
- Runtime overrides: `getRuntimeConfigSnapshot`, `setRuntimeConfigSnapshot`

**Architecture:**

- **Single source of truth:** Real config lives in sibling files (`io.ts`, `types.js`, `validation.js`, etc.)
- **Caching strategy:** Snapshots + hash tracking for change detection
- **Extensibility:** Validation pipeline supports plugin-aware config validation

---

## 2. src/config/types.memory.ts

**Purpose:** Type definitions for memory backend configuration (not user habits).

**Data Structures:**

```typescript
MemoryBackend = "builtin" | "qmd" | "lancedb"
MemoryConfig {
  backend?: MemoryBackend
  citations?: MemoryCitationsMode
  qmd?: MemoryQmdConfig
  lancedb?: MemoryLanceDbConfig
}
```

**Key Config Points:**

| Config                            | Default                        | Purpose                             |
| --------------------------------- | ------------------------------ | ----------------------------------- |
| `lancedb.logFullConversation`     | true                           | Persist full chat turns             |
| `lancedb.storagePath`             | ~/.shittimchest/memory/lancedb | Where embeddings live               |
| `lancedb.profileSensei.enabled`   | true                           | Background profile extraction       |
| `lancedb.profileSensei.batchSize` | 10                             | Batch user messages before analysis |
| `lancedb.reflectSchedule`         | "0 3 \* \* \*"                 | Nightly reflection cron             |
| `qmd.mcporter.enabled`            | false                          | Route QMD through MCP runtime       |
| `qmd.searchMode`                  | query                          | "query" \| "search" \| "vsearch"    |

**What's Hardcoded:** Backend selection; search algorithm; reflection schedule expression

**Configurable:** All timing, paths, and backend parameters

**Extension Points:**

- Can add new `MemoryBackend` types
- Can extend `MemoryQmdConfig` or `MemoryLanceDbConfig` with new options

---

## 3. src/plugins/tools.ts

**Purpose:** Resolve and load tools from plugins; manage tool namespacing and conflicts.

**Key Exports:**

```typescript
resolvePluginTools(params: {
  context: ShittimChestPluginToolContext
  existingToolNames?: Set<string>
  toolAllowlist?: string[]
  suppressNameConflicts?: boolean
}): AnyAgentTool[]

getPluginToolMeta(tool: AnyAgentTool): PluginToolMeta | undefined
```

**How State is Managed:**

- **WeakMap storage:** `pluginToolMeta` tracks plugin origin + optionality per tool
- **Registry loading:** Calls `loadShittimChestPlugins()` with config + workspace dir
- **No persistence:** Tools are resolved fresh on each call (computed, not stored)

**Conflict Resolution:**

1. Plugin ID matches existing tool name → blocked
2. Tool name duplicates → blocked (per plugin or cross-plugin)
3. Optional tools filtered by allowlist (individual tool name or `group:plugins`)

**Configurable:**

- `toolAllowlist`: Which optional tools to enable
- `suppressNameConflicts`: Whether to log/reject naming conflicts
- Test plugin defaults (applied automatically in tests)

**Extension Points:**

- Plugin registry interface (tools can be single or arrays)
- Factory pattern: `entry.factory(context)` lets plugins compute tools dynamically
- Optional tool system allows third-party tools to be disabled by default

---

## 4. src/agents/tools/common.ts

**Purpose:** Utility types and functions for tool I/O and validation.

**Key Exports:**

```typescript
AnyAgentTool = AgentTool<any, unknown> & { ownerOnly?: boolean }

// Param readers with coercion
readStringParam(params, key, options?)
readNumberParam(params, key, options?)
readStringArrayParam(params, key, options?)
readStringOrNumberParam(params, key, options?)
readReactionParams(params, options)
parseAvailableTags(raw)

// Result builders
jsonResult(payload)
imageResult(params)
imageResultFromFile(params)

// Authorization
createActionGate(actions)
wrapOwnerOnlyToolExecution(tool, senderIsOwner)
```

**Data Structures:**

```typescript
StringParamOptions {
  required?: boolean
  trim?: boolean
  label?: string
  allowEmpty?: boolean
}

ActionGate<T> = (key: keyof T, defaultValue?: boolean) => boolean

ToolInputError extends Error { status = 400 }
ToolAuthorizationError extends ToolInputError { status = 403 }
```

**Parameter Handling Features:**

- **Snake_case fallback:** `readStringParam("fooBar")` also tries `"foo_bar"`
- **Type coercion:** Numbers can be read as strings; strings parsed as numbers
- **Flexible arrays:** Single strings convert to single-element arrays
- **Emoji validation:** Reaction params check for empty emoji + remove flag combo

**Authorization:**

- `ownerOnly` flag on tools is enforced via wrapper
- `ActionGate` pattern for permission tables (e.g., `{ read: true, delete: false }`)

**Configurable:** None—all behavior is logic-based, not config-driven

**Extension Points:**

- New param readers can be added (pattern is established)
- `AvailableTag` structure is plugin-facing (used in Discord-like contexts)
- Image sanitization limits can be passed to `imageResult*` functions

---

## 5. src/arona/habits/habit-tracker.ts

**Purpose:** Core learning engine. Detects Sensei's sleep/wake cycle from message timestamps.

**Key Exports:**

```typescript
HabitTracker {
  recordActivity(timestampMs?)
  analyzeSchedule(): LearnedSchedule | null
  setExplicitSchedule(opts, reason): ExplicitSchedule
  clearExplicitSchedule()
  getResolvedSchedule(): ResolvedSchedule
  buildScheduleContext(): string | undefined
  buildStatusSummary(): string
  getData(): Readonly<HabitData>
  flush()
}

getHabitTracker(): HabitTracker | null  // Singleton accessor
```

**State Persistence:**

- **File location:** `{workspaceDir}/.arona/user-habits.json`
- **Atomic writes:** Temp file + rename pattern
- **Debounced saves:** 30 second debounce (SAVE_DEBOUNCE_MS)
- **Format:** JSON with version field for future migrations

**Data Structure (HabitData):**

```json
{
  "version": 1,
  "recentActivity": [{ "timestampMs": ..., "hour": 0-23 }, ...],
  "learned": {
    "wakeHour": 7.5,
    "sleepHour": 23.5,
    "confidence": 0.75,
    "lastAnalyzedAt": "2026-04-13T...",
    "dataPointDays": 10
  },
  "explicit": {
    "wakeHour": 8,
    "sleepHour": 24,
    "setAt": "...",
    "reason": "..."
  }
}
```

**Hardcoded Constants:**
| Constant | Value | Purpose |
|----------|-------|---------|
| SAVE_DEBOUNCE_MS | 30,000 | Batch disk writes |
| MIN_RECORDS_FOR_ANALYSIS | 20 | Minimum messages before learning |
| REANALYZE_THRESHOLD | 15 | Trigger reanalysis after N new records |
| ACTIVITY_RETENTION_DAYS | 14 | Rolling window (from types.ts) |
| MIN_SLEEP_GAP_HOURS | 4 | Minimum quiet window = sleep |
| MIN_LEARNED_CONFIDENCE | 0.5 | Use learned schedule if ≥ 0.5 |
| HYSTERESIS_HOURS | 1 | Minimum hour change to update |
| HYSTERESIS_CONFIDENCE_DELTA | 0.15 | Minimum confidence improvement |

**Algorithm: Longest Quiet Gap**

1. Build 24-hour histogram with exponential decay (7-day half-life)
2. Normalize histogram to [0, 1]
3. Find longest contiguous quiet window (< 0.1 normalized)
4. Derive sleep hour = gap start; wake hour = gap end
5. Calculate confidence from: data quantity (0-0.4) + gap clarity (0-0.35) + contrast (0-0.25)
6. Apply hysteresis to prevent thrashing

**Confidence Calculation:**

```
quantityScore = min(dataPointDays / 7, 1) × 0.4
clarityScore = (gapLength / 24) × 2 × 0.35
contrastScore = min((activeAvg - quietAvg) × 1.5, 1) × 0.25

confidence = quantityScore + clarityScore + contrastScore
// Cap at 0.3 if < 3 days of data
// Final cap: [0, 1]
```

**Priority Chain (Resolved Schedule):**

1. Explicit override (if set)
2. Learned pattern (if confidence ≥ 0.5)
3. Defaults (wake=7, sleep=23, confidence=0)

**Configurable vs Hardcoded:**

- **Hardcoded:** All thresholds, half-life, quiet threshold, window retention
- **Not in config:** This is embedded domain logic, not user-configurable
- **Dynamically tunable:** Could add config later, but would require validation

**Extension Points:**

- `buildScheduleContext()` generates system prompt injection (Vietnamese text)
- `buildStatusSummary()` could be extended to include more metrics
- `recordActivity()` hook point for other systems to track activity

**State Invalidation:**

- Activity records auto-pruned on load and after each record
- Hysteresis prevents continuous small changes
- Lazy re-analysis (triggered only when REANALYZE_THRESHOLD new records arrive)

---

## 6. src/arona/habits/schedule-applicator.ts

**Purpose:** Broadcast resolved user schedule to 4 timing-sensitive subsystems (health, proactive, dreaming).

**Key Exports:**

```typescript
applyScheduleToSubsystems(
  schedule: ResolvedSchedule,
  opts?: {
    skipHealth?: boolean
    skipProactive?: boolean
    skipDreaming?: boolean
  }
): void

setSubsystemHandles(handles: SubsystemHandles): void

interface SubsystemHandles {
  healthRestart?: () => void
  proactiveRestart?: () => void
}
```

**State Management:**

- **Module-level:** Single `handles` object stores subsystem callbacks
- **No persistence:** Pure in-memory registry
- **Initialization:** Called once during server boot via `setSubsystemHandles()`

**Subsystem Integration:**

| Subsystem         | Config Updated          | Function                   | Time Offset                   |
| ----------------- | ----------------------- | -------------------------- | ----------------------------- |
| Health (water)    | activeStart / activeEnd | Wake → Sleep               | No offset                     |
| Health (eyes)     | activeStart / activeEnd | Wake → Sleep+1             | +1h for late-night screen     |
| Health (movement) | activeStart / activeEnd | Wake → Sleep               | No offset                     |
| Health (sleep)    | activeStart / activeEnd | Sleep-1 → Sleep            | -1h reminder window           |
| Proactive         | wakeHour, sleepHour     | Time windows + nudge range | Passed directly               |
| Dreaming          | dreamStart, dreamEnd    | Sleep+3 → Sleep+5          | 3–5h after sleep (deep phase) |

**Invocation Points:**

1. Server boot (if learned/explicit schedule exists)
2. After `HabitTracker.analyzeSchedule()` completes
3. After `HabitTracker.setExplicitSchedule()` or `clearExplicitSchedule()`

**Hardcoded Offsets:**

- Eyes: +1 hour (captures late-night browsing)
- Sleep reminder: -1 hour (prep time)
- Dream timing: +3 to +5 hours after sleep (established sleep science)

**Configurable:** Currently none—all offsets are hardcoded.

**Extension Points:**

- `opts` parameter allows selective subsystem updates (for testing)
- `setSubsystemHandles()` allows new subsystems to register
- Subsystem handles use callback pattern (easy to add `dreaming` → mutation without tight coupling)

**Error Handling:**

- Wrapped in try-catch per subsystem (one failure doesn't block others)
- Logged at debug level (not fatal)

---

## 7. src/arona/habits/types.ts

**Purpose:** Shared type definitions for habit learning system.

**Key Exports:**

```typescript
// Activity
ActivityRecord { timestampMs, hour }

// Learning outputs
LearnedSchedule { wakeHour, sleepHour, confidence, lastAnalyzedAt, dataPointDays }

// User input
ExplicitSchedule { wakeHour?, sleepHour?, setAt, reason }

// Persisted state
HabitData { recentActivity[], learned, explicit, version }

// Final answer
ResolvedSchedule { wakeHour, sleepHour, source, confidence }

// Constants
DEFAULT_SCHEDULE = { wakeHour: 7, sleepHour: 23, source: "default", confidence: 0 }
ACTIVITY_RETENTION_DAYS = 14
MIN_SLEEP_GAP_HOURS = 4
MIN_LEARNED_CONFIDENCE = 0.5
HYSTERESIS_HOURS = 1
HYSTERESIS_CONFIDENCE_DELTA = 0.15
```

**Data Flow:**

```
ActivityRecord[] → analyzeSchedule() → LearnedSchedule
ExplicitSchedule (user input) → setExplicitSchedule()
                     ↓
        HabitData (persisted to JSON)
                     ↓
   getResolvedSchedule() → ResolvedSchedule (priority chain)
                     ↓
   applyScheduleToSubsystems() → updates health/proactive/dreaming
```

**Configurable:** All constants can theoretically be moved to config, but currently hardcoded for reliability.

---

## 8. src/arona/mood-ticker.ts

**Purpose:** Autonomous background mood updates every 15 minutes (environmental context only, no chat required).

**Key Exports:**

```typescript
runMoodTick(opts: MoodTickerOptions, nowMs?): void
startMoodTicker(opts: MoodTickerOptions): MoodTickerHandle
setScheduleHours(wakeHour: number, sleepHour: number): void

interface MoodTickerOptions {
  workspaceDir: string
  onMoodUpdate?: (state: EmotionalState, triggers: MoodTrigger[]) => void
  getLastInteractionMs?: () => number | null
}

interface MoodTickerHandle {
  stop(): void
  tick(): void  // Force immediate evaluation
}
```

**State Management:**

- **Mood state:** Loaded from workspace persistence (shared with companion module)
- **Schedule hours:** Module-level variables (set by habit tracker via `setScheduleHours()`)
- **Timers:** Two-tier (initial 30s delay + 15-min interval)

**Hardcoded Timing:**
| Constant | Value | Purpose |
|----------|-------|---------|
| TICK_INTERVAL_MS | 900,000 | 15-minute ticks |
| INITIAL_DELAY_MS | 30,000 | 30s startup delay (let weather/location load) |
| ABSENCE_MILD_MS | 10,800,000 | 3 hours = mild loneliness |
| ABSENCE_HEAVY_MS | 28,800,000 | 8 hours = deep sadness/worried |
| ABSENCE_MAX_MS | 86,400,000 | 24 hours = cap absence effect |

**Time Mode Categories** (9 modes anchored to wake/sleep):

```
early-morning:  [wake-1, wake)       → sleepy (0.35) + caring (0.1)
morning:        [wake, wake+3)       → happy (0.2) + excited (0.1)
midday:         [wake+3, wake+6)     → focused (0.15) + neutral (0.1)
afternoon:      [wake+6, wake+9)     → focused (0.1) + bored (0.05)
late-afternoon: [wake+9, wake+12)    → focused (0.1) + caring (0.05)
evening:        [sleep-5, sleep-2)   → caring (0.2) + nostalgic (0.1)
night:          [sleep-2, sleep)     → sleepy (0.2) + caring (0.15)
late-night:     [sleep, sleep+3)     → sleepy (0.4) + worried (0.15)
deep-night:     [sleep+3, wake-1)    → sleepy (0.5) + worried (0.1)
```

**Mood Triggers (per tick):**

1. **Time-of-day:** Always evaluated (see table above)
2. **Weather:** If weather data available → `analyzeWeatherMoodTrigger()`
3. **Absence:** If `getLastInteractionMs()` provided
   - 0–3h: No trigger
   - 3–8h: Mild (bored + caring)
   - 8–24h: Heavy (sad + worried)
   - Scaling: Linear ramp from mild to heavy threshold

**Absence Math:**

```
factor = min(1, (elapsed - MILD_MS) / (MAX_MS - MILD_MS))

// Heavy (≥ 8h)
sad: 0.2 → 0.4
worried: 0.1 → 0.25

// Mild (3–8h)
bored: 0.15 → 0.25
caring: 0.1 → 0.2
sad: 0.05 → 0.1
```

**Lifecycle:**

1. Initial timeout (30s) → allows weather/location to populate
2. First tick → immediate evaluation
3. 15-min intervals thereafter
4. Timers marked `.unref()` → process can exit even if ticker running
5. `stop()` cleans up both timers

**Integration Points:**

- `setScheduleHours()` called by habit tracker after learning new schedule
- `onMoodUpdate` callback fires when mood changes (allows UI updates)
- `getLastInteractionMs` callback allows external activity tracking

**Error Handling:**

- `runMoodTick()` wrapped in try-catch in `safeTick()`
- Never crashes server even on mood ticker errors

**Configurable:**

- Tick interval (hardcoded, could move to config)
- Initial delay (hardcoded)
- Absence thresholds (hardcoded)
- Time mode boundaries (relative to wake/sleep, not absolute)

**Extension Points:**

- `onMoodUpdate` callback for downstream listeners
- `analyzeWeatherMoodTrigger()` is external (can be swapped)
- New triggers can be added between existing ones

---

## System Integration Map

```
┌──────────────────────────────────────┐
│  User Chat Activity                  │
└──────────────┬───────────────────────┘
               │
               v
      recordActivity(timestamp)
               │
       ┌───────┴────────┐
       v                v
   HabitTracker    (dirty flag)
       │                │
       └────────┬───────┘
              [debounce 30s]
                  │
                  v
        analyzeSchedule()
          [Longest Quiet Gap]
                  │
        ┌─────────┴──────────┐
        v                    v
   LearnedSchedule    HabitData (JSON)
        │                 (persisted)
        │
        └──────────────────┬──────────────────┐
                          v                  v
                 setExplicitSchedule()  clearExplicitSchedule()
                          │                  │
                   ┌──────┴──────────────────┘
                   v
             getResolvedSchedule()
            [Priority: explicit > learned > default]
                   │
                   v
        applyScheduleToSubsystems()
          [via SubsystemHandles]
                   │
    ┌──────────────┼──────────────┬─────────────┐
    v              v              v             v
 Health      Proactive       Dreaming     (extensible)
reminders   scheduler       scheduler
(water,     (nudge times)   (dream window)
eyes,move,
sleep)

                    ↓
             buildScheduleContext()
            [Injected into system prompt]


Parallel: Mood Ticker
┌──────────────────────────┐
│ Every 15 minutes         │
├──────────────────────────┤
│ 1. Time-of-day → mood    │
│ 2. Weather → mood        │
│ 3. Absence → mood        │
│ 4. Natural decay applied │
│ 5. Callback: onMoodUpdate│
└──────────────────────────┘
    (updated by setScheduleHours)
```

---

## Config System Summary

### What's Configurable:

1. **Memory system** (`types.memory.ts`):
   - Backend selection (builtin/qmd/lancedb)
   - Storage paths
   - Batch sizes, timeouts, schedules

2. **Plugin tools** (`plugins/tools.ts`):
   - Tool allowlists
   - Conflict suppression

3. **Habit parameters** (currently NOT config):
   - Thresholds live in `types.ts` as constants
   - Could move to config for runtime tuning

### What's Hardcoded:

1. **Habit learning:**
   - All thresholds, decay functions, hysteresis values
   - Reason: Complex domain logic, sensitive to tuning

2. **Mood ticker:**
   - Tick interval (15 min)
   - Absence thresholds (3h, 8h, 24h)
   - Time mode mappings
   - Reason: Behavioral, not user-tunable

3. **Schedule applicator:**
   - Subsystem offsets (eyes +1h, sleep -1h, dreams +3-5h)
   - Reason: Fixed by domain (sleep science, UI patterns)

### Extension Points (for new features):

1. **Habits:**
   - New triggers for `recordActivity()` (besides chat)
   - New subsystems in `applyScheduleToSubsystems()` via handles

2. **Mood:**
   - New triggers between existing ones
   - New `onMoodUpdate` listeners
   - Custom activity source via `getLastInteractionMs`

3. **Tools:**
   - New param readers following established patterns
   - New tool authorization gates
   - Plugin-provided tools via `resolvePluginTools()`

4. **Config:**
   - New backends in `MemoryBackend` type
   - New memory options in respective config types

---

## Migration & Version Strategy

| System     | Version Field          | Migration Path                               |
| ---------- | ---------------------- | -------------------------------------------- |
| HabitData  | `version: 1`           | Future v2 can be added, old data auto-pruned |
| Mood state | (shared persistence)   | Version via companion module                 |
| Config     | (top-level validation) | Zod schema enforces shape                    |

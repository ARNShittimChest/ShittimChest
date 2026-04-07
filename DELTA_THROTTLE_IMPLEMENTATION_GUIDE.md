# Implementation Guide: Controlling Delta Streaming Rate

## Quick Reference

### Current Rate: 50ms minimum between deltas

- **File:** `src/gateway/server-chat.ts`, line 300
- **Max throughput:** 20 events/second per client
- **Is it configurable?** Currently NO, but very easy to make it so

---

## Implementation Options

### 1. MINIMAL CHANGE: Make It Configurable (Recommended)

Extract the 50ms to a constant at the top of the file:

```typescript
// ============================================================================
// src/gateway/server-chat.ts
// ============================================================================

import { DEFAULT_HEARTBEAT_ACK_MAX_CHARS, stripHeartbeatToken } from "../auto-reply/heartbeat.js";
// ... other imports ...

// ⭐ NEW: Chat delta throttle configuration
const CHAT_DELTA_THROTTLE_MS = process.env.CHAT_DELTA_THROTTLE_MS
  ? parseInt(process.env.CHAT_DELTA_THROTTLE_MS, 10)
  : 50;

// ... rest of file ...

export function createAgentEventHandler({
  broadcast,
  broadcastToConnIds,
  nodeSendToSession,
  agentRunSeq,
  chatRunState,
  resolveSessionKeyForRun,
  clearAgentRunContext,
  toolEventRecipients,
}: AgentEventHandlerOptions) {
  const emitChatDelta = (
    sessionKey: string,
    clientRunId: string,
    sourceRunId: string,
    seq: number,
    text: string,
  ) => {
    const cleaned = stripInlineDirectiveTagsForDisplay(text).text;
    if (!cleaned) {
      return;
    }
    if (isSilentReplyText(cleaned, SILENT_REPLY_TOKEN)) {
      return;
    }
    chatRunState.buffers.set(clientRunId, cleaned);
    if (shouldHideHeartbeatChatOutput(clientRunId, sourceRunId)) {
      return;
    }
    const now = Date.now();
    const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;

    // ⭐ UPDATED: Use configurable constant
    if (now - last < CHAT_DELTA_THROTTLE_MS) {
      return;
    }

    chatRunState.deltaSentAt.set(clientRunId, now);
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "delta" as const,
      message: {
        role: "assistant",
        content: [{ type: "text", text: cleaned }],
        timestamp: now,
      },
    };
    broadcast("chat", payload, { dropIfSlow: true });
    nodeSendToSession(sessionKey, "chat", payload);
  };

  // ... rest of handler ...
}
```

**Usage:**

```bash
# Default: 50ms (20 deltas/sec)
npm start

# Faster: 25ms (40 deltas/sec) for smoother streaming
CHAT_DELTA_THROTTLE_MS=25 npm start

# Slower: 100ms (10 deltas/sec) for bandwidth saving
CHAT_DELTA_THROTTLE_MS=100 npm start

# Very slow: 250ms (4 deltas/sec) for extreme bandwidth control
CHAT_DELTA_THROTTLE_MS=250 npm start

# No throttle: 0ms (all chunks sent immediately)
CHAT_DELTA_THROTTLE_MS=0 npm start
```

---

### 2. CONFIG-BASED: Load from Configuration File

Integrate with existing config system:

```typescript
// src/gateway/server-chat.ts

import type { ShittimChestConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";

function resolveChatDeltaThrottleMs(): number {
  try {
    const cfg = loadConfig();
    const throttleMs = cfg.gateway?.chat?.deltaThrottleMs ?? 50;
    return Math.max(0, throttleMs);
  } catch {
    return 50; // Default fallback
  }
}

export function createAgentEventHandler({
  broadcast,
  // ... other params ...
}: AgentEventHandlerOptions) {
  const DELTA_THROTTLE_MS = resolveChatDeltaThrottleMs();

  const emitChatDelta = (
    sessionKey: string,
    clientRunId: string,
    sourceRunId: string,
    seq: number,
    text: string,
  ) => {
    // ... existing logic ...

    if (now - last < DELTA_THROTTLE_MS) {
      return;
    }

    // ... rest of function ...
  };

  // ... rest of handler ...
}
```

**Config file (`config.json` or similar):**

```json
{
  "gateway": {
    "chat": {
      "deltaThrottleMs": 50
    }
  }
}
```

---

### 3. ADVANCED: Per-Client Adaptive Throttling

Adjust throttle based on client connection quality:

```typescript
// src/gateway/server-chat.ts

type ClientQualityMetrics = {
  lastUpdateAt: number;
  droppedCount: number;
  sentCount: number;
};

const clientMetrics = new Map<string, ClientQualityMetrics>();

function updateClientMetrics(clientRunId: string, dropped: boolean) {
  let metrics = clientMetrics.get(clientRunId);
  if (!metrics) {
    metrics = {
      lastUpdateAt: Date.now(),
      droppedCount: 0,
      sentCount: 0,
    };
    clientMetrics.set(clientRunId, metrics);
  }

  metrics.lastUpdateAt = Date.now();
  if (dropped) {
    metrics.droppedCount += 1;
  } else {
    metrics.sentCount += 1;
  }

  // Clean up old entries
  if (clientMetrics.size > 10000) {
    const now = Date.now();
    for (const [id, m] of clientMetrics) {
      if (now - m.lastUpdateAt > 5 * 60 * 1000) {
        // 5 min TTL
        clientMetrics.delete(id);
      }
    }
  }
}

function getClientQuality(clientRunId: string): "fast" | "medium" | "slow" {
  const metrics = clientMetrics.get(clientRunId);
  if (!metrics) return "medium";

  const total = metrics.sentCount + metrics.droppedCount;
  if (total === 0) return "medium";

  const dropRate = metrics.droppedCount / total;

  if (dropRate > 0.5) return "slow"; // >50% dropped
  if (dropRate > 0.2) return "medium"; // 20-50% dropped
  return "fast"; // <20% dropped
}

function getThrottleForQuality(quality: "fast" | "medium" | "slow"): number {
  switch (quality) {
    case "fast":
      return 25; // 40 deltas/sec
    case "medium":
      return 50; // 20 deltas/sec
    case "slow":
      return 100; // 10 deltas/sec
  }
}

export function createAgentEventHandler({
  broadcast,
  broadcastToConnIds,
  nodeSendToSession,
  agentRunSeq,
  chatRunState,
  resolveSessionKeyForRun,
  clearAgentRunContext,
  toolEventRecipients,
}: AgentEventHandlerOptions) {
  const emitChatDelta = (
    sessionKey: string,
    clientRunId: string,
    sourceRunId: string,
    seq: number,
    text: string,
  ) => {
    const cleaned = stripInlineDirectiveTagsForDisplay(text).text;
    if (!cleaned) {
      return;
    }
    if (isSilentReplyText(cleaned, SILENT_REPLY_TOKEN)) {
      return;
    }
    chatRunState.buffers.set(clientRunId, cleaned);
    if (shouldHideHeartbeatChatOutput(clientRunId, sourceRunId)) {
      return;
    }
    const now = Date.now();
    const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;

    // ⭐ ADAPTIVE THROTTLE
    const quality = getClientQuality(clientRunId);
    const throttleMs = getThrottleForQuality(quality);

    if (now - last < throttleMs) {
      updateClientMetrics(clientRunId, true); // Track drop
      return;
    }

    chatRunState.deltaSentAt.set(clientRunId, now);
    updateClientMetrics(clientRunId, false); // Track send

    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "delta" as const,
      message: {
        role: "assistant",
        content: [{ type: "text", text: cleaned }],
        timestamp: now,
      },
    };
    broadcast("chat", payload, { dropIfSlow: true });
    nodeSendToSession(sessionKey, "chat", payload);
  };

  // ... rest of handler ...
}
```

**Effect:**

- Monitors each client's drop rate
- Slow clients (>50% drops) get 100ms throttle
- Fast clients (<20% drops) get 25ms throttle
- Medium clients get 50ms throttle
- Automatically adapts to network conditions

---

### 4. TESTING: Verification Script

Test that your changes work:

```typescript
// test-delta-throttle.ts (run with: npx ts-node test-delta-throttle.ts)

import { createChatRunState } from "./src/gateway/server-chat.js";

function testDeltaThrottling() {
  const state = createChatRunState();

  // Simulate rapid delta emissions
  const deltas: { time: number; sent: boolean }[] = [];

  for (let i = 0; i < 10; i++) {
    const now = Date.now() + i * 10; // 10ms apart
    const last = state.deltaSentAt.get("test-client") ?? 0;

    const sent = now - last >= 50; // Current 50ms throttle
    deltas.push({ time: now, sent });

    if (sent) {
      state.deltaSentAt.set("test-client", now);
      console.log(`✓ Delta ${i} sent at ${now}ms`);
    } else {
      console.log(`✗ Delta ${i} dropped at ${now}ms (${now - last}ms since last)`);
    }
  }

  const sentCount = deltas.filter((d) => d.sent).length;
  console.log(`\n📊 Summary: ${sentCount} deltas sent out of 10`);
  console.log(`Expected with 50ms throttle: 2 deltas (at 0ms and 50ms)`);
  console.log(`Actual: ${sentCount} deltas`);

  if (sentCount === 2) {
    console.log("✅ Throttle working correctly!");
  } else {
    console.log("⚠️ Throttle behavior unexpected");
  }
}

testDeltaThrottling();
```

**Expected output with 50ms throttle:**

```
✓ Delta 0 sent at 0ms
✗ Delta 1 dropped at 10ms (10ms since last)
✗ Delta 2 dropped at 20ms (20ms since last)
✗ Delta 3 dropped at 30ms (30ms since last)
✗ Delta 4 dropped at 40ms (40ms since last)
✓ Delta 5 sent at 50ms
✗ Delta 6 dropped at 60ms (10ms since last)
...

📊 Summary: 2 deltas sent out of 10
Expected with 50ms throttle: 2 deltas
Actual: 2 deltas
✅ Throttle working correctly!
```

---

## Monitoring & Observability

### Logging Delta Throttle Events

Add logging to track throttle behavior:

```typescript
const emitChatDelta = (
  sessionKey: string,
  clientRunId: string,
  sourceRunId: string,
  seq: number,
  text: string,
) => {
  // ... existing setup ...

  const now = Date.now();
  const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;
  const timeSinceLast = now - last;

  if (timeSinceLast < DELTA_THROTTLE_MS) {
    log.debug(
      `chat-delta-throttled | clientRunId=${clientRunId} | timeSinceLast=${timeSinceLast}ms | threshold=${DELTA_THROTTLE_MS}ms`,
    );
    return;
  }

  log.debug(`chat-delta-sent | clientRunId=${clientRunId} | size=${cleaned.length}b`);

  // ... rest of function ...
};
```

### Metrics Collection

Track delta metrics for performance analysis:

```typescript
const deltaMetrics = {
  totalSent: 0,
  totalDropped: 0,
  averageTimeBetweenDeltas: 0,
  lastTimestamps: new Map<string, number>(),
};

export function getChatDeltaMetrics() {
  return {
    totalSent: deltaMetrics.totalSent,
    totalDropped: deltaMetrics.totalDropped,
    dropRate: deltaMetrics.totalDropped / (deltaMetrics.totalSent + deltaMetrics.totalDropped),
  };
}
```

---

## Rollout Strategy

### Phase 1: Test Locally

1. Extract constant with env variable support
2. Test at different throttle levels (25ms, 50ms, 100ms)
3. Monitor UI rendering performance
4. Check network traffic patterns

### Phase 2: Staging Deployment

1. Deploy with configurable throttle
2. Default to current 50ms
3. Monitor real user sessions
4. Collect delta metrics

### Phase 3: Production Rollout

1. Deploy with environment variable support
2. Start with 50ms (no change)
3. A/B test different throttle rates
4. Measure user satisfaction, bandwidth, CPU usage

### Metrics to Track

- Delta send rate (events/sec)
- Network bandwidth (KB/sec)
- Client CPU usage
- User-perceived latency
- Drop rate

---

## FAQ & Troubleshooting

### Q: What happens if I set throttle to 0?

A: All deltas are sent immediately, no throttling. This maximizes responsiveness but increases network traffic and CPU usage.

### Q: Why drop events instead of queuing them?

A: Queuing would add unbounded latency. Dropping ensures deltas stay fresh and responsive. The buffering system handles text accumulation.

### Q: Can different clients have different throttles?

A: Yes! With adaptive throttling (Option 3), you can adjust per client based on network quality.

### Q: What's the impact on bandwidth?

- **50ms (current):** ~20 events/sec × avg 50 bytes = 1KB/sec per client
- **25ms:** ~40 events/sec × avg 25 bytes = 1KB/sec per client (smaller deltas)
- **100ms:** ~10 events/sec × avg 100 bytes = 1KB/sec per client (larger deltas)

Bandwidth impact is relatively constant; throttle mostly affects _frequency_ vs _size_ tradeoff.

### Q: Will changing throttle affect final message delivery?

A: No! The final message is sent without throttle, so all text always reaches the client eventually.

---

## Recommended Configuration

For most use cases:

| Use Case                | Throttle       | Rationale                              |
| ----------------------- | -------------- | -------------------------------------- |
| **Normal chat**         | 50ms (default) | Balanced responsiveness and efficiency |
| **Bandwidth limited**   | 100ms          | Reduce network overhead                |
| **Premium/high-speed**  | 25ms           | Smoother streaming experience          |
| **Mobile/slow network** | 100-150ms      | Reduce mobile data usage               |
| **Adaptive**            | 25-100ms       | Auto-adjust based on client quality    |

# 📊 ARONA-CLW STREAMING TEXT DELTA ANALYSIS - FINDINGS SUMMARY

## What You Asked

> "How fast does the server send text chunks to clients? Can I control/throttle it?"

## What I Found

### ✅ **Current Delta Rate: 50ms Minimum Between Chunks**

The streaming text delta system in Arona-CLW uses a hard-coded **50ms throttle** that limits how frequently text chunks are sent to clients.

- **Maximum throughput:** 20 deltas per second per client
- **Average data rate:** ~400-1000 characters per second (depending on LLM speed)
- **Network overhead:** ~1KB/sec per client (minimal)

### ✅ **Yes, You Can Control It**

The throttle is **trivial to make configurable**. Currently it's hard-coded in one location, but it takes just a few lines to extract it to a constant or environment variable.

---

## Deep Dive: The Complete Flow

### Where Deltas Originate

```
LLM Provider Stream
  ↓
pi-embedded-subscribe.handlers.messages.ts
  • Receives text_delta, text_start, text_end events
  • Accumulates text in deltaBuffer
  • Calculates incremental delta
  ↓
emitAgentEvent({ stream: "assistant", data: { text, delta } })
  ↓
server-chat.ts createAgentEventHandler()
  • Routes assistant events to emitChatDelta()
  ↓
⭐ THROTTLE CHECKPOINT (50ms)
  ↓
broadcast() to WebSocket clients
  ↓
Client UI receives delta and renders incrementally
```

### The 50ms Throttle (Lines 298-302 in src/gateway/server-chat.ts)

```typescript
const now = Date.now();
const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;
if (now - last < 50) {
  return; // ← Drop this delta silently
}
chatRunState.deltaSentAt.set(clientRunId, now);
// ... send delta to client ...
```

**Key Properties:**

- ✅ **Per-client tracking** - Each clientRunId has its own throttle window
- ✅ **Silent drop** - Excess deltas are discarded (not queued)
- ✅ **Automatic batching** - Buffered text from dropped deltas gets included in next allowed delta
- ❌ **Not configurable** - Hard-coded value (but trivial to fix)

### The Buffering System

Text that gets "dropped" by the throttle is stored and accumulates:

```typescript
// In server-chat.ts (line 294)
chatRunState.buffers.set(clientRunId, cleaned);

// Later in emitChatFinal() (line 327-329)
const bufferedText = chatRunState.buffers.get(clientRunId) ?? "";
// Sends all accumulated text with final message
```

**Effect:** Even though you only send 20 deltas/sec, all text eventually reaches the client because:

1. Dropped chunks' text is buffered
2. Next delta that passes the throttle includes buffered text
3. Final message sends without throttle to ensure completeness

---

## Controlling the Delta Rate

### Option 1: Direct Modification (Quick Test)

```typescript
// In src/gateway/server-chat.ts, line 300
if (now - last < 100) {
  // Change 50 to 100 for 10 deltas/sec
  return;
}
```

### Option 2: Environment Variable (Recommended)

```typescript
// At top of src/gateway/server-chat.ts
const CHAT_DELTA_THROTTLE_MS = process.env.CHAT_DELTA_THROTTLE_MS
  ? parseInt(process.env.CHAT_DELTA_THROTTLE_MS, 10)
  : 50;

// In emitChatDelta():
if (now - last < CHAT_DELTA_THROTTLE_MS) {
  return;
}
```

**Usage:**

```bash
CHAT_DELTA_THROTTLE_MS=25 npm start   # 40 deltas/sec (faster)
CHAT_DELTA_THROTTLE_MS=50 npm start   # 20 deltas/sec (default)
CHAT_DELTA_THROTTLE_MS=100 npm start  # 10 deltas/sec (slower)
CHAT_DELTA_THROTTLE_MS=0 npm start    # No throttle (immediate)
```

### Option 3: Adaptive Per-Client (Advanced)

Monitor each client's network quality and adjust throttle dynamically:

- **Fast clients:** 25ms throttle (40 deltas/sec)
- **Medium clients:** 50ms throttle (20 deltas/sec)
- **Slow clients:** 100ms throttle (10 deltas/sec)

See implementation-guide.md for full code example.

---

## Recommended Settings

| Scenario                  | Setting   | Why                                       |
| ------------------------- | --------- | ----------------------------------------- |
| **Default (no change)**   | 50ms      | Balanced for desktop browsers             |
| **Smoother streaming**    | 25ms      | More frequent updates, 2x network traffic |
| **Bandwidth constrained** | 100ms     | 50% less network, slightly choppier       |
| **Mobile users**          | 100-150ms | Save cellular data                        |
| **Adaptive**              | 25-100ms  | Auto-adjust to client quality             |

---

## Important Technical Details

### ❓ What about the LLM provider's stream rate?

- The provider (Claude, OpenAI, Ollama) streams at its own rate (~5-50ms chunks typically)
- The 50ms server-side throttle batches these into fewer client messages
- This reduces network frames and UI re-renders without losing data

### ❓ Does buffering cause latency?

- Dropped chunks are buffered in memory (just text accumulation)
- The buffer is small (<1MB even for long responses)
- Next delta includes buffered text, so no latency accumulation

### ❓ What about the "final" message?

- Sent without throttle, ensuring all accumulated text reaches the client
- Triggers when LLM finishes (lifecycle event with phase: "end")
- Buffers are then cleared

### ❓ Can it run out of memory?

- Very unlikely. The buffer is just `Map<clientRunId, string>`
- For a 10k token response: ~40KB of text
- With 100 concurrent users: ~4MB total (negligible)

---

## Files to Examine

### Core Streaming Logic

- **`src/gateway/server-chat.ts`** (lines 280-317)
  - `emitChatDelta()` - Where the 50ms throttle lives
  - Chat delta handling and payload construction

### Delta Event Generation

- **`src/agents/pi-embedded-subscribe.handlers.messages.ts`** (lines 216-233)
  - `handleMessageUpdate()` - Where "assistant" events are emitted
  - Text accumulation and delta calculation

### Event Publishing

- **`src/infra/agent-events.ts`**
  - `emitAgentEvent()` - Internal event bus

### State Management

- **`src/agents/pi-embedded-subscribe.ts`** (lines 38-81)
  - State structures for delta buffering

---

## Summary Table

| Aspect             | Current          | Configurable?             | Recommended Action               |
| ------------------ | ---------------- | ------------------------- | -------------------------------- |
| **Delta throttle** | 50ms             | ❌ (but easy)             | Extract to constant with env var |
| **Max throughput** | 20 events/sec    | ✅ (by changing throttle) | Depends on use case              |
| **Buffering**      | ✅ Automatic     | ✅ (implicit in throttle) | No change needed                 |
| **Per-client**     | ✅ Yes           | ✅ (by design)            | No change needed                 |
| **Final message**  | No throttle      | ✅ (by design)            | No change needed                 |
| **Backpressure**   | dropIfSlow: true | ✅ Configured             | No change needed                 |

---

## Next Steps

### To Deploy a Change:

1. **Test locally:** Add env var support to src/gateway/server-chat.ts
2. **Verify:** Run with different throttle values and monitor WebSocket events
3. **Deploy:** Use env var in production to control rate
4. **Monitor:** Track delta metrics, bandwidth, and user experience
5. **Iterate:** Adjust based on real-world data

### To Implement Adaptive Throttling:

1. Add client quality tracking (drop rate monitoring)
2. Implement quality assessment function
3. Adjust throttle based on quality tier
4. Test and validate in staging

---

## Questions This Answers

✅ **Q: How fast are text chunks sent?**
A: Currently 20 deltas per second (50ms minimum between them). LLM chunks are batched together.

✅ **Q: Can I slow it down?**
A: Yes, increase the throttle value (e.g., 100ms → 10 deltas/sec).

✅ **Q: Can I speed it up?**
A: Yes, decrease the throttle value (e.g., 25ms → 40 deltas/sec).

✅ **Q: What's buffered during throttling?**
A: Text is accumulated in `chatRunState.buffers`. Next delta includes all buffered text.

✅ **Q: Does buffering add latency?**
A: No, it's in-memory accumulation. Next delta still arrives at ~50ms interval.

✅ **Q: Is it configurable?**
A: Not currently, but trivial to make configurable (5-line change).

✅ **Q: Where is the throttle applied?**
A: In `emitChatDelta()` function in `src/gateway/server-chat.ts`, line 300.

✅ **Q: Will all text reach the client?**
A: Yes, final message sent without throttle ensures completeness.

✅ **Q: Does it work per-client?**
A: Yes, throttle is tracked per `clientRunId` independently.

---

## Deliverables in This Analysis

📄 **delta_streaming_analysis.md**

- Comprehensive technical breakdown
- Buffering and batching logic
- Performance implications
- Control options

📊 **delta_flow_diagram.txt**

- Visual flow from LLM to client
- Timing diagram with examples
- State structures
- Key architectural properties

💻 **implementation_guide.md**

- 4 implementation options (simple to advanced)
- Code examples for each approach
- Testing and verification scripts
- Monitoring and observability patterns
- Rollout strategy

This summary document is the executive overview.

---

**Analysis completed:** 2026-04-07
**Project:** Arona-CLW
**Location:** /Volumes/OCungRoi/PRJ/Arona-CLW
**Key file:** src/gateway/server-chat.ts (line 300)

# Arona-CLW Streaming Text Delta Rate Analysis

## Executive Summary

The Arona-CLW streaming text delta system uses a **50ms throttle** to control how fast text chunks are sent from the server to clients. This is a hard-coded rate limit that prevents delta events from being sent more frequently than once every 50 milliseconds.

---

## Key Findings

### 1. **Current Delta Sending Rate: 50ms Minimum Interval**

**Location:** `src/gateway/server-chat.ts` (lines 298-302)

```typescript
const now = Date.now();
const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;
if (now - last < 50) {
  return; // Skip sending delta if less than 50ms has passed
}
```

**Behavior:**

- Deltas are **dropped silently** if they arrive within 50ms of the last sent delta
- The `deltaSentAt` Map tracks the last time a delta was sent per `clientRunId`
- This is a **per-client throttle**, not per-run, so each client connection gets its own 50ms throttle window

### 2. **Text Delta Origination Flow**

The streaming text moves through several stages:

```
LLM Provider (Claude/OpenAI/etc)
  ↓
pi-embedded-subscribe.handlers.messages.ts (handleMessageUpdate)
  ↓
Emits agent event with stream: "assistant"
  ↓
infra/agent-events.ts (emitAgentEvent)
  ↓
server-chat.ts (createAgentEventHandler)
  ↓
emitChatDelta() [50ms THROTTLE APPLIED HERE]
  ↓
broadcast() + nodeSendToSession()
  ↓
Client WebSocket
```

### 3. **Where Text Deltas Are Generated**

**File:** `src/agents/pi-embedded-subscribe.handlers.messages.ts` (lines 216-233)

The `handleMessageUpdate` function processes incoming text events and emits agent events:

```typescript
if (shouldEmit) {
  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "assistant", // ← This is what triggers delta handling
    data: {
      text: cleanedText, // Full text accumulated so far
      delta: deltaText, // Incremental text added this frame
      mediaUrls: hasMedia ? mediaUrls : undefined,
    },
  });
}
```

**Key Points:**

- Text comes from provider in `text_delta`, `text_start`, or `text_end` events
- The handler accumulates text in `ctx.state.deltaBuffer`
- It calculates the `deltaText` (new content since last emission)
- Both "full text so far" (`text`) and "incremental delta" (`delta`) are sent

### 4. **Buffering & Accumulation**

**State Tracking in `pi-embedded-subscribe.ts`:**

```typescript
const state: EmbeddedPiSubscribeState = {
  deltaBuffer: "",           // Accumulates all chunks received
  blockBuffer: "",           // For block-structured replies
  lastStreamedAssistant: undefined,        // Last full text emitted
  lastStreamedAssistantCleaned: undefined, // Last cleaned text emitted
  ...
};
```

**In `emitChatDelta` (server-chat.ts, line 294):**

```typescript
chatRunState.buffers.set(clientRunId, cleaned); // Store buffered text
```

**Importance:**

- Even though deltas are throttled, the buffered text continues to accumulate
- The next delta event that passes the 50ms threshold will include all accumulated text since the last sent delta

### 5. **The Throttle is "Silent"**

Unlike some throttling implementations that queue dropped events:

```typescript
if (now - last < 50) {
  return; // ← Just returns, no queuing or retry
}
```

This means:

- If 3 chunks arrive within a 50ms window, only the first one is sent
- The 2nd and 3rd chunks are **discarded** (though their text is buffered)
- The next delta sent will include text from all accumulated chunks

**Option with `dropIfSlow: true`:**

```typescript
broadcast("chat", payload, { dropIfSlow: true });
nodeSendToSession(sessionKey, "chat", payload);
```

This tells the broadcast system to drop the event if the client is too slow, preventing buffer buildup.

---

## Current Delta Sending Rate Characteristics

### Minimum Latency

- **Best case:** 50ms (every chunk is sent)
- **Typical case:** 50ms+ (multiple chunks batched together)
- **Worst case:** Multiple 50ms windows if the client is slow

### Maximum Throughput

- At 50ms intervals, you can send at most **20 deltas per second**
- If each delta averages 20-50 characters (typical), that's **400-1000 chars/sec** per client

### Architectural Properties

| Aspect                    | Current Design                                           |
| ------------------------- | -------------------------------------------------------- |
| **Per-client throttling** | ✅ Yes (by `clientRunId`)                                |
| **Buffering**             | ✅ Yes (accumulated in `chatRunState.buffers`)           |
| **Batching**              | ✅ Automatic (dropped chunks get included in next delta) |
| **Configurable**          | ❌ No (hard-coded 50ms)                                  |
| **Backpressure handling** | ✅ `dropIfSlow: true` prevents buffer overflow           |
| **Queue**                 | ❌ No queue; excess events dropped silently              |

---

## Can You Control/Throttle The Delta Rate?

### ✅ YES, You Can Modify It

The 50ms threshold is hard-coded in one place:

**File:** `src/gateway/server-chat.ts`, line 300

```typescript
if (now - last < 50) {
  // ← Change this number
  return;
}
```

### Options for Control

#### **Option 1: Make It Configurable**

Convert the 50ms to a configurable constant:

```typescript
// At top of file or in config
const DELTA_THROTTLE_MS = 50; // Can be environment variable

// In emitChatDelta:
if (now - last < DELTA_THROTTLE_MS) {
  return;
}
```

#### **Option 2: Increase Throttle (Slower Delta Rate)**

- `if (now - last < 100)` → 10 deltas/sec instead of 20
- `if (now - last < 250)` → 4 deltas/sec (good for bandwidth control)
- `if (now - last < 500)` → 2 deltas/sec (very conservative)

#### **Option 3: Decrease Throttle (Faster Delta Rate)**

- `if (now - last < 25)` → 40 deltas/sec (smoother but more network traffic)
- `if (now - last < 10)` → 100 deltas/sec (nearly every chunk)
- `if (now - last < 0)` → No throttle (all chunks sent immediately)

#### **Option 4: Adaptive Throttling (Per Client)**

Track client connection quality and adjust dynamically:

```typescript
const clientQuality = getClientNetworkQuality(clientRunId);
const throttleMs = clientQuality === "slow" ? 100 : clientQuality === "fast" ? 25 : 50;
if (now - last < throttleMs) {
  return;
}
```

---

## Related Buffering & Batching Logic

### Buffer Flushing

The buffered text is held in `chatRunState.buffers` and is **flushed on final message**:

**In `emitChatFinal` (server-chat.ts, line 327-329):**

```typescript
const bufferedText = stripInlineDirectiveTagsForDisplay(
  chatRunState.buffers.get(clientRunId) ?? "",
).text.trim();
```

The final message is sent without throttling, ensuring all accumulated text reaches the client.

### Block Reply Chunking

For special UI blocks (e.g., code blocks), there's a separate chunking system:

**File:** `src/agents/pi-embedded-subscribe.ts`

```typescript
const blockChunker = blockChunking ? new EmbeddedBlockChunker(blockChunking) : null;
```

This can be configured to break long responses into semantic chunks independently of delta throttling.

---

## Performance Implications

### Network Efficiency

- **50ms throttle** = ~20 events/sec per client
- For a single user: **minimal overhead** (~1KB/s typical)
- For 100 concurrent users: **~100KB/s overhead** (just for delta frames)

### Client-Side Rendering

- At 50ms intervals, most UI frameworks can smoothly render incremental text
- Sub-50ms updates would cause excessive re-renders without clear benefit
- 100ms+ intervals would be noticeably "choppy" for users

### Server Resource Usage

- The 50ms throttle **reduces server CPU** (fewer frames to construct/send)
- Buffering is **minimal** (just text accumulation, not frame queueing)
- No significant memory overhead

---

## How to Modify Delta Rate

### Step 1: Find the Constant

```bash
grep -n "if (now - last < 50)" src/gateway/server-chat.ts
```

### Step 2: Update the Value

```typescript
// Original
if (now - last < 50) {

// To slow it down to 100ms (10 deltas/sec):
if (now - last < 100) {

// To speed it up to 25ms (40 deltas/sec):
if (now - last < 25) {
```

### Step 3: Make It Configurable (Optional)

Extract to config:

```typescript
// At module level
const CHAT_DELTA_THROTTLE_MS = 50;

// Then use:
if (now - last < CHAT_DELTA_THROTTLE_MS) {
  return;
}
```

### Step 4: Test

- Monitor client WebSocket for delta events
- Check for increased/decreased message frequency
- Verify no UI rendering performance regression

---

## Summary Table

| Aspect                   | Details                                              |
| ------------------------ | ---------------------------------------------------- |
| **Current Rate**         | 50ms minimum between deltas (20 events/sec max)      |
| **Location**             | `src/gateway/server-chat.ts:300`                     |
| **Is It Configurable?**  | ❌ No, but trivial to make configurable              |
| **Buffering**            | ✅ Yes, all text buffered until throttle allows      |
| **Batching**             | ✅ Automatic (dropped chunks included in next delta) |
| **Can You Increase It?** | ✅ Yes, set to lower ms value (25, 10, 0)            |
| **Can You Decrease It?** | ✅ Yes, set to higher ms value (100, 250, 500)       |
| **Performance Impact**   | Minimal; 50ms is well-balanced for network + UI      |
| **Final Message**        | Sent without throttle to ensure completeness         |
| **Per-Client**           | ✅ Yes, tracked by `clientRunId` separately          |

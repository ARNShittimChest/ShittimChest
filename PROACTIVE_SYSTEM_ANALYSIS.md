# Arona Proactive System: Complete Streaming & Cross-Platform Delivery Analysis

## Executive Summary

The proactive system sends time-based messages (morning greetings, lunch reminders, evening checks, late-night goodbyes, and random nudges) **only to the "proactive" session using the internal webchat channel**. These messages:

1. Generate replies via the agent
2. Stream deltas to connected WebSocket clients
3. **Enqueue iOS push notifications** via the push handler
4. Are **NOT routed to Discord, Telegram, or other external channels**

This is intentional: proactive messages have `OriginatingChannel: "webchat"`, which is non-routable. Only messages with proper `OriginatingChannel` (Discord, Telegram, etc.) can route back to those platforms.

---

## Part 1: The Proactive Scheduler Flow

### 1.1 Random Time Windows (scheduler.ts)

The scheduler fires at **randomized times** within four daily windows:

```typescript
const TIME_WINDOWS = [
  { key: "morning", startHour: 5.5, endHour: 7.5, includeWeather: true },
  { key: "lunch", startHour: 11.5, endHour: 13.0, includeWeather: true },
  { key: "evening", startHour: 20.0, endHour: 22.5, includeWeather: false },
  { key: "late-night", startHour: 23.0, endHour: 24.5, includeWeather: false },
];
```

Plus random nudges every 2.5–5 hours during waking hours (6 AM–10 PM).

**Key mechanism:** `msUntilRandomInWindow()` generates a random hour/minute within the window, sets a timeout, and reschedules the next day with a new random offset.

### 1.2 Execution Logging

All firings (scheduled and executed) are logged to `.arona/proactive-log.json`:

```typescript
{
  "timestamp": "2026-04-07T08:45:00Z",
  "windowKey": "morning",
  "success": true,
  "scheduledFor": "2026-04-08T06:23:00Z"
}
```

**Why this matters:** If you see no entries for a window, the scheduler itself didn't fire (process crash, system sleep, etc.).

---

## Part 2: The Gateway Wiring (server.impl.ts lines 898–935)

### 2.1 Proactive Trigger Handler

When a window fires, the scheduler calls this handler:

```typescript
proactiveSchedulerStop = startProactiveScheduler(
  async (event) => {
    try {
      const handler = coreGatewayHandlers["chat.send"];
      if (handler) {
        log.info(
          `[Proactive] Firing window="${event.windowKey}" → sending to session "proactive"`
        );

        const proactiveParams = {
          sessionKey: "proactive",           // ← Fixed session name
          message: event.prompt,             // ← System prompt (Vietnamese)
          idempotencyKey: `proactive-${Date.now()}`,
        };

        await handler({
          req: { ... },
          params: proactiveParams,
          context: gCtxOffline,              // ← Offline context (no user connection)
          client: {
            connect: { role: "operator", agent: resolveDefaultAgentId(cfgAtStart) },
          },
          isWebchatConnect: () => false,
          respond: () => {},                 // ← No HTTP response needed
        });

        log.info(`[Proactive] window="${event.windowKey}" delivered successfully`);
      }
    } catch (err) {
      log.error(`[Proactive] Failed window="${event.windowKey}": ${String(err)}`);
    }
  },
  { workspaceDir: defaultWorkspaceDir },
);
```

**Critical context:** `gCtxOffline` means this is **not associated with any WebSocket client connection**. It's a fire-and-forget async operation.

---

## Part 3: The chat.send Handler (chat.ts lines 688–998)

### 3.1 Request Setup

```typescript
"chat.send": async ({ params, respond, context, client }) => {
  // Receives proactiveParams: { sessionKey: "proactive", message: "...", idempotencyKey: "..." }

  // Creates message context:
  const ctx: MsgContext = {
    Body: parsedMessage,
    BodyForAgent: stampedMessage,
    BodyForCommands: commandBody,
    SessionKey: sessionKey,              // ← "proactive"
    Provider: INTERNAL_MESSAGE_CHANNEL,  // ← "webchat"
    Surface: INTERNAL_MESSAGE_CHANNEL,   // ← "webchat"
    OriginatingChannel: INTERNAL_MESSAGE_CHANNEL,  // ← "webchat" ← KEY!
    ChatType: "direct",
    CommandAuthorized: true,
    MessageSid: clientRunId,
    SenderId: clientInfo?.id,
    ...
  };
```

### 3.2 Dispatcher Setup

The reply dispatcher is created with a simple `deliver` callback that **only collects text**:

```typescript
const dispatcher = createReplyDispatcher({
  ...prefixOptions,
  onError: (err) => {
    context.logGateway.warn(`webchat dispatch failed: ${err}`);
  },
  deliver: async (payload, info) => {
    if (info.kind !== "final") {
      return;
    }
    const text = payload.text?.trim() ?? "";
    if (!text) {
      return;
    }
    finalReplyParts.push(text); // ← Accumulate text for later
  },
});
```

### 3.3 The Inbound Message Dispatch

```typescript
void dispatchInboundMessage({
  ctx,          // ← Has OriginatingChannel: "webchat"
  cfg,
  dispatcher,
  replyOptions: {
    runId: clientRunId,
    abortSignal: abortController.signal,
    onAgentRunStart: (runId) => {
      agentRunStarted = true;
      const connId = typeof client?.connId === "string" ? client.connId : undefined;
      // Register this run for tool events if a connection exists
      if (connId && wantsToolEvents) {
        context.registerToolEventRecipient(runId, connId);
      }
    },
    onModelSelected,
  },
})
  .then(() => {
    if (!agentRunStarted) {
      // No agent was invoked (e.g., pre-reply dispatch handled it)
      // Build reply from finalReplyParts
      const combinedReply = finalReplyParts.join("\n\n").trim();
      if (combinedReply) {
        const appended = appendAssistantTranscriptMessage({
          message: combinedReply,
          sessionId,
          storePath,
          sessionFile: entry?.sessionFile,
          agentId,
          createIfMissing: true,
        });
        if (appended.ok) {
          message = appended.message;
        }
      }
      broadcastChatFinal({
        context,
        runId: clientRunId,
        sessionKey: rawSessionKey,
        message,
      });
    }
    // ...
  })
  .catch((err) => {
    broadcastChatError({ context, runId: clientRunId, sessionKey: rawSessionKey, ... });
  })
  .finally(() => {
    context.chatAbortControllers.delete(clientRunId);
  });
```

---

## Part 4: The Auto-Reply Dispatch (dispatch-from-config.ts)

### 4.1 The Critical Check: `shouldRouteToOriginating`

```typescript
const originatingChannel = ctx.OriginatingChannel; // ← "webchat"
const originatingTo = ctx.OriginatingTo; // ← undefined
const currentSurface = (ctx.Surface ?? ctx.Provider)?.toLowerCase(); // ← "webchat"

const shouldRouteToOriginating = Boolean(
  isRoutableChannel(originatingChannel) && originatingTo && originatingChannel !== currentSurface,
);
```

**isRoutableChannel check:**

```typescript
export function isRoutableChannel(
  channel: OriginatingChannelType | undefined,
): channel is Exclude<OriginatingChannelType, typeof INTERNAL_MESSAGE_CHANNEL> {
  if (!channel || channel === INTERNAL_MESSAGE_CHANNEL) {
    return false; // ← "webchat" returns FALSE
  }
  // ... checks for telegram, discord, etc.
}
```

**Result:** `shouldRouteToOriginating = false` because:

1. `originatingChannel === "webchat"` (INTERNAL_MESSAGE_CHANNEL)
2. `isRoutableChannel("webchat")` returns **false**
3. Even if it were true, `originatingTo` is undefined

### 4.2 Message Gets Handled Locally

Since `shouldRouteToOriginating === false`, the message is **NOT routed to external channels**. Instead, it's processed through the local reply stack, which:

1. **Calls the agent** if needed (via `getReplyFromConfig`)
2. **Streams deltas** back to WebSocket clients (via `emitChatDelta`)
3. **Enqueues a push notification** to iOS (via `enqueuePush`)

---

## Part 5: Streaming Text to Clients (server-chat.ts)

### 5.1 The Agent Event Handler

```typescript
const agentEventHandler = createAgentEventHandler({
  broadcast, // ← Broadcasts to all WebSocket clients on the "chat" channel
  broadcastToConnIds,
  nodeSendToSession, // ← Sends to node subscribers for a session
  agentRunSeq,
  chatRunState,
  resolveSessionKeyForRun,
  clearAgentRunContext,
  toolEventRecipients,
});
```

When the agent generates text, it fires `"assistant"` stream events:

```typescript
if (!isAborted && evt.stream === "assistant" && typeof evt.data?.text === "string") {
  emitChatDelta(sessionKey, clientRunId, evt.runId, evt.seq, evt.data.text);
}
```

### 5.2 The Delta Emission

```typescript
const emitChatDelta = (
  sessionKey: string,
  clientRunId: string,
  sourceRunId: string,
  seq: number,
  text: string,
) => {
  const cleaned = stripInlineDirectiveTagsForDisplay(text).text;
  if (!cleaned) return;
  if (isSilentReplyText(cleaned, SILENT_REPLY_TOKEN)) return;

  chatRunState.buffers.set(clientRunId, cleaned);
  if (shouldHideHeartbeatChatOutput(clientRunId, sourceRunId)) return;

  // Throttle: only send deltas every 50ms minimum
  const now = Date.now();
  const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;
  if (now - last < 50) return;

  chatRunState.deltaSentAt.set(clientRunId, now);

  const payload = {
    runId: clientRunId,
    sessionKey,
    seq,
    state: "delta", // ← STREAMING STATE
    message: {
      role: "assistant",
      content: [{ type: "text", text: cleaned }],
      timestamp: now,
    },
  };

  broadcast("chat", payload, { dropIfSlow: true }); // ← Send to ALL WebSocket clients
  nodeSendToSession(sessionKey, "chat", payload); // ← Send to node subscribers
};
```

**Key behavior:**

- Deltas are **throttled to 50ms intervals** to avoid overwhelming clients
- Messages can be dropped if WebSocket buffers fill up (`dropIfSlow: true`)
- Sent to **all connected WebSocket clients** on the "chat" channel

### 5.3 Final Message Emission

When the agent finishes:

```typescript
else if (!isAborted && (lifecyclePhase === "end" || lifecyclePhase === "error")) {
  emitChatFinal(sessionKey, clientRunId, evt.runId, evt.seq, jobState, error);
}
```

```typescript
const emitChatFinal = (
  sessionKey: string,
  clientRunId: string,
  sourceRunId: string,
  seq: number,
  jobState: "done" | "error",
  error?: unknown,
) => {
  const bufferedText = stripInlineDirectiveTagsForDisplay(
    chatRunState.buffers.get(clientRunId) ?? "",
  ).text.trim();

  const normalizedHeartbeatText = normalizeHeartbeatChatFinalText({
    runId: clientRunId,
    sourceRunId,
    text: bufferedText,
  });

  const text = normalizedHeartbeatText.text.trim();
  const shouldSuppressSilent =
    normalizedHeartbeatText.suppress || isSilentReplyText(text, SILENT_REPLY_TOKEN);

  chatRunState.buffers.delete(clientRunId);
  chatRunState.deltaSentAt.delete(clientRunId);

  if (jobState === "done") {
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "final",
      message:
        text && !shouldSuppressSilent
          ? {
              role: "assistant",
              content: [{ type: "text", text }],
              timestamp: Date.now(),
            }
          : undefined,
    };
    broadcast("chat", payload);
    nodeSendToSession(sessionKey, "chat", payload);
    return;
  }
  // ... error case
};
```

---

## Part 6: iOS Push Notification Delivery (push-handler.ts)

### 6.1 Push Enqueueing

After a proactive message is generated, it's enqueued for iOS via two mechanisms:

**Mechanism 1: When chat.send completes (chat.ts)**

```typescript
// In broadcastChatFinal (chat-utils.ts lines 510–522)
try {
  const contentArr = Array.isArray(params.message?.content) ? params.message?.content : [];
  const textChunks = contentArr
    .filter((c: any) => c && c.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text);
  const bodyInfo = textChunks.join("\n").trim();
  if (bodyInfo) {
    enqueuePush({ title: "Arona", body: bodyInfo }); // ← Push enqueued here
  }
} catch {
  // disregard parse errors for push
}
```

**Mechanism 2: When chat.inject is called (chat.ts lines 1058–1068)**

```typescript
// Auto-enqueue push for injected messages (e.g. from proactive scheduler / boot.md logic)
try {
  const contentArr = Array.isArray(appended.message?.content) ? appended.message?.content : [];
  const textChunks = contentArr
    .filter((c: any) => c && c.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text);
  const bodyInfo = textChunks.join("\n").trim();
  if (bodyInfo) {
    enqueuePush({ title: "Arona", body: bodyInfo });
  }
} catch {}
```

### 6.2 The In-Memory Queue (pending-store.ts)

```typescript
const queue: PendingMessage[] = [];

export function enqueuePush(msg: { title: string; body: string }): void {
  queue.push({
    title: msg.title,
    body: msg.body,
    queuedAt: new Date().toISOString(),
  });
  flushWaiters(); // ← Wake any long-poll waiters
}
```

### 6.3 iOS App Polling Routes

| Route                   | Method | Purpose                                       |
| ----------------------- | ------ | --------------------------------------------- |
| `/arona/push/pending`   | GET    | Called by BGAppRefreshTask; drains queue      |
| `/arona/push/long-poll` | GET    | Holds connection for up to 25s; wakes on push |
| `/arona/push/mood`      | GET    | Returns mood snapshot for widget              |
| `/arona/push/weather`   | GET    | Returns weather for widget                    |

**Flow:**

1. iOS app registers via `POST /arona/push/register` (local/BGFetch platform)
2. App polls `GET /arona/push/pending` every 15–30 minutes
3. For near-instant delivery: iOS opens `GET /arona/push/long-poll?timeout=25000`
4. When `enqueuePush()` is called, waiters are woken immediately
5. App drains the queue and displays notification

---

## Part 7: Why Proactive Messages DON'T Go to Discord/Telegram

### 7.1 The Channel Routing Check

In `dispatch-from-config.ts`, the decision to route to external channels is made here:

```typescript
const shouldRouteToOriginating = Boolean(
  isRoutableChannel(originatingChannel) && originatingTo && originatingChannel !== currentSurface,
);
```

For proactive messages:

- `originatingChannel = "webchat"` (INTERNAL_MESSAGE_CHANNEL)
- `originatingTo = undefined` (no target user/channel)
- `currentSurface = "webchat"`

**Result:** `shouldRouteToOriginating = false`

### 7.2 What WOULD Route to Channels

If a user sends a message from Telegram, the context is:

```typescript
ctx.OriginatingChannel = "telegram";
ctx.OriginatingTo = chat_id;
ctx.Surface = "telegram";
```

Then:

```typescript
isRoutableChannel("telegram"); // → true (not INTERNAL_MESSAGE_CHANNEL)
originatingTo; // → defined (chat_id)
"telegram" !== "telegram"; // → false, BUT if different:
// Example: user from Telegram, reply needs to go to Discord:
//   originatingChannel = "telegram"
//   currentSurface = "discord"
//   "telegram" !== "discord"    // → true
// Then shouldRouteToOriginating = true
```

**So routing works when:**

1. A message comes from Channel A (e.g., Telegram)
2. The reply needs to go to Channel B (e.g., Discord, or back to Telegram if Surface changed)

### 7.3 Proactive Messages Have No OriginatingChannel Routing

Proactive messages are **generated inside the system**, not triggered by a user message. They have:

- No real user on any channel
- `OriginatingChannel = "webchat"` (internal only)
- No `OriginatingTo` target

Therefore, they **can ONLY** be delivered via:

1. **WebSocket** to connected clients (if any)
2. **iOS push** to the local Arona app

**They are intentionally NOT routed to Discord, Telegram, or email.**

---

## Part 8: Silent Failure Diagnosis

### 8.1 How Proactive Messages Can Silently Fail

**Scenario 1: Proactive Session Doesn't Exist**

- `loadSessionEntry("proactive")` returns no match in sessions.json
- The session is created if `createIfMissing: true`, but if the session store is corrupted or missing, the message fails silently

**Scenario 2: Agent Doesn't Generate Reply**

- The system prompt is sent to the agent
- If the agent crashes or times out, no reply is generated
- The push is still enqueued, but might be empty text

**Scenario 3: No WebSocket Clients Connected**

- Deltas are broadcast to all WebSocket clients
- If no client is listening to the "chat" channel, broadcasts are dropped on the floor
- **This is not a failure — it's expected.** The iOS app gets the push instead.

**Scenario 4: Push Queue Fills Silently**

- If the pending-store queue grows unbounded (no iOS app polling), messages accumulate
- They're held in memory only; if the process restarts, they're lost

### 8.2 Debugging Checklist

✅ **Check the proactive log:**

```bash
cat ~/.shittimchest/workspace/.arona/proactive-log.json | tail -20
```

If you see no entries for a window, the scheduler didn't fire.

✅ **Check gateway logs for proactive messages:**

```
grep "\[Proactive\]" gateway.log
```

✅ **Verify the session exists:**

```bash
cat ~/.shittimchest/workspace/sessions.json | grep '"proactive"'
```

✅ **Check if agent runs are happening:**

```
grep "onAgentRunStart\|agent.*run\|workflow.*start" gateway.log
```

✅ **Verify push notifications are queued:**

```bash
curl -s http://localhost:8888/arona/push/tokens -H "Authorization: Bearer $(cat ~/.shittimchest/workspace/gateway-token.txt)" | jq .
```

✅ **Check if any WebSocket clients are connected:**

```
grep "registerToolEventRecipient\|broadcast.*chat" gateway.log
```

---

## Part 9: Full Message Flow Diagram

```
PROACTIVE SCHEDULER
    ↓
    Fires at random time within window (morning/lunch/evening/late-night)
    ↓
SCHEDULER TRIGGER
    event = { prompt: "[System] Vietnamese system message", windowKey: "morning" }
    ↓
CHAT.SEND HANDLER
    sessionKey: "proactive"
    message: event.prompt
    context: gCtxOffline (no WebSocket connection)
    ↓
CREATE MESSAGE CONTEXT
    OriginatingChannel: "webchat"  ← KEY: INTERNAL ONLY
    OriginatingTo: undefined       ← NO TARGET USER/CHANNEL
    Surface: "webchat"
    Provider: "webchat"
    ↓
DISPATCH INBOUND MESSAGE
    ctx.OriginatingChannel = "webchat"
    ↓
    CHECK: shouldRouteToOriginating = isRoutableChannel("webchat") && originatingTo && ...
    ↓
    isRoutableChannel("webchat") → FALSE  ← INTERNAL CHANNEL, CAN'T ROUTE
    ↓
PROCESS LOCALLY
    ├─→ Agent generates reply (via dispatchInboundMessage)
    │   ↓
    │   AGENT EVENTS → STREAM DELTAS
    │   │
    │   ├─→ emitChatDelta (every 50ms)
    │   │   ├─→ broadcast("chat", delta, { dropIfSlow: true })  ← To all WebSocket clients
    │   │   └─→ nodeSendToSession("proactive", "chat", delta)   ← To node subscribers
    │   │
    │   └─→ emitChatFinal (on agent lifecycle end/error)
    │       ├─→ broadcast("chat", final)
    │       ├─→ nodeSendToSession("proactive", "chat", final)
    │       └─→ enqueuePush({ title: "Arona", body: "..." })  ← TO iOS QUEUE
    │
    ├─→ Message stored in proactive session transcript
    │
    └─→ BroadcastChatFinal (if no agent run)
        ├─→ appendAssistantTranscriptMessage()
        ├─→ broadcast("chat", final)
        └─→ enqueuePush()

iOS APP POLLING
    ↓
    Long-poll: GET /arona/push/long-poll?timeout=25000
    ↓
    (Waiter registered in pending-store)
    ↓
    When enqueuePush() called → flushWaiters()
    ↓
    Response sent: { ok: true, messages: [...], mood: {...} }
    ↓
    iOS displays notification
```

---

## Part 10: Summary Table

| Component                    | Proactive Session          | Regular User Message                              |
| ---------------------------- | -------------------------- | ------------------------------------------------- |
| Triggered by                 | Scheduler timer            | User sends message                                |
| Channel                      | `"proactive"`              | Any session (agent:main:main, etc.)               |
| OriginatingChannel           | `"webchat"` (internal)     | `"telegram"`, `"discord"`, etc.                   |
| OriginatingTo                | `undefined`                | User/channel ID                                   |
| Routes to external channels? | **NO**                     | **YES** (if OriginatingChannel ≠ current Surface) |
| WebSocket broadcast?         | Yes (if clients listening) | Yes (if clients listening)                        |
| iOS push notification?       | **YES**                    | Depends on config                                 |
| Transcript saved?            | Yes                        | Yes                                               |
| Typing indicators sent?      | Suppressed (internal)      | Yes (if enabled)                                  |

---

## Conclusion

The Arona proactive system is **a closed loop** that:

1. Generates time-based messages to the internal "proactive" session
2. Streams deltas to WebSocket clients (if connected)
3. **Always enqueues an iOS push notification** for the local app
4. **Intentionally does NOT route to Discord, Telegram, or other external channels**

If proactive messages aren't reaching you:

- **Check the proactive-log.json** — is the scheduler firing?
- **Check your iOS app** — is it polling for push notifications?
- **Check the session transcript** — is the message being saved?
- **Verify the agent is working** — try a manual chat.send to the proactive session

The system is **designed for local, personal notifications** (iOS + WebSocket clients in your own dashboard), not for broadcasting to team channels like Discord.

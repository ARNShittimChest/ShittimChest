# Proactive System: Code Map & Data Flow

## Entry Point: Scheduler Fires (scheduler.ts:258-270)

```typescript
export function startProactiveScheduler(
  onTrigger: ProactiveTrigger,
  options?: ProactiveSchedulerOptions,
): Disposable {
  // Initiate log path
  initLogPath(options?.workspaceDir);

  // Schedule 4 time windows + random nudges
  const stops = [
    ...TIME_WINDOWS.map((w) => scheduleWindow(w, onTrigger)), // ← 4 daily windows
    scheduleRandomNudge(onTrigger), // ← 2.5-5 hour nudges
  ];

  return () => stops.forEach((s) => s());
}
```

### Window Scheduling (scheduler.ts:186-213)

```typescript
function scheduleWindow(window: TimeWindow, onTrigger: ProactiveTrigger): Disposable {
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;

  function fire() {
    if (stopped) return;

    // 1. Get weather hint (if configured)
    const weatherHint = getWeatherHint(window.includeWeather);

    // 2. Build Vietnamese system prompt
    const prompt = window.buildPrompt(weatherHint);

    // 3. Trigger the handler
    onTrigger({ prompt, windowKey: window.key });

    // 4. Schedule next occurrence (tomorrow, random time)
    const nextMs = msUntilRandomInWindow(window.startHour, window.endHour);
    logScheduled(window.key, nextMs);
    timer = setTimeout(fire, nextMs);
  }

  // Initial scheduling for today
  const initialMs = msUntilRandomInWindow(window.startHour, window.endHour);
  logScheduled(window.key, initialMs);
  timer = setTimeout(fire, initialMs);

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
```

---

## Gateway Wiring: Scheduler → chat.send (server.impl.ts:898-935)

### Initialization

```typescript
// server.impl.ts:898-935
if (!minimalTestGateway) {
  proactiveSchedulerStop = startProactiveScheduler(
    async (event) => {
      // This callback is invoked when a window fires
      // event = { prompt: "...", windowKey: "morning|lunch|evening|late-night|nudge" }

      try {
        const handler = coreGatewayHandlers["chat.send"];
        if (handler) {
          log.info(
            `[Proactive] Firing window="${event.windowKey}" → sending to session "proactive"`,
          );

          const proactiveParams = {
            sessionKey: "proactive",
            message: event.prompt,
            idempotencyKey: `proactive-${Date.now()}`,
          };

          await handler({
            req: {
              type: "req" as const,
              id: `proactive-${Date.now()}`,
              method: "chat.send",
              params: proactiveParams,
            },
            params: proactiveParams,
            context: gCtxOffline, // ← No WebSocket client
            client: {
              connect: { role: "operator", agent: resolveDefaultAgentId(cfgAtStart) },
            } as any,
            isWebchatConnect: () => false,
            respond: () => {}, // ← Fire-and-forget
          });

          log.info(`[Proactive] window="${event.windowKey}" delivered successfully`);
        } else {
          log.warn(`[Proactive] chat.send handler not found — cannot deliver`);
        }
      } catch (err) {
        log.error(`[Proactive] Failed window="${event.windowKey}": ${String(err)}`);
      }
    },
    { workspaceDir: defaultWorkspaceDir },
  );
}
```

---

## Handler: chat.send (chat.ts:688-998)

### Setup

```typescript
"chat.send": async ({ params, respond, context, client }) => {
  // 1. Validate parameters
  if (!validateChatSendParams(params)) { /* error */ return; }

  const p = params as {
    sessionKey: string;      // ← "proactive"
    message: string;         // ← System prompt
    thinking?: string;
    deliver?: boolean;
    attachments?: ...;
    timeoutMs?: number;
    idempotencyKey: string;  // ← "proactive-<timestamp>"
  };

  // 2. Sanitize message
  const sanitizedMessageResult = sanitizeChatSendMessageInput(p.message);
  if (!sanitizedMessageResult.ok) { /* error */ return; }

  const inboundMessage = sanitizedMessageResult.message;

  // 3. Load session (creates "proactive" session if missing)
  const rawSessionKey = p.sessionKey;  // "proactive"
  const { cfg, entry, canonicalKey: sessionKey } = loadSessionEntry(rawSessionKey);

  // 4. Check send policy
  const sendPolicy = resolveSendPolicy({ cfg, entry, sessionKey, channel: entry?.channel });
  if (sendPolicy === "deny") { /* error */ return; }

  // 5. Create message context
  const ctx: MsgContext = {
    Body: parsedMessage,
    BodyForAgent: stampedMessage,         // Timestamp injected
    BodyForCommands: commandBody,
    RawBody: parsedMessage,
    SessionKey: sessionKey,               // ← "proactive"
    Provider: INTERNAL_MESSAGE_CHANNEL,   // ← "webchat"
    Surface: INTERNAL_MESSAGE_CHANNEL,    // ← "webchat"
    OriginatingChannel: INTERNAL_MESSAGE_CHANNEL,  // ← KEY: "webchat" (not routable)
    OriginatingTo: undefined,             // ← No target
    ChatType: "direct",
    CommandAuthorized: true,
    MessageSid: clientRunId,
    SenderId: clientInfo?.id,
    SenderName: clientInfo?.displayName,
    SenderUsername: clientInfo?.displayName,
    GatewayClientScopes: client?.connect?.scopes,
  };

  // 6. Get agent ID
  const agentId = resolveSessionAgentId({ sessionKey, config: cfg });

  // 7. Create reply dispatcher (will collect reply text)
  const finalReplyParts: string[] = [];
  const dispatcher = createReplyDispatcher({
    ...prefixOptions,
    onError: (err) => {
      context.logGateway.warn(`webchat dispatch failed: ${formatForLog(err)}`);
    },
    deliver: async (payload, info) => {
      if (info.kind !== "final") return;
      const text = payload.text?.trim() ?? "";
      if (!text) return;
      finalReplyParts.push(text);  // ← Accumulate reply
    },
  });

  // 8. Send ACK to caller (if any)
  const ackPayload = {
    runId: clientRunId,
    status: "started" as const,
  };
  respond(true, ackPayload, undefined, { runId: clientRunId });

  // 9. Dispatch inbound message (async)
  void dispatchInboundMessage({
    ctx,      // ← Has OriginatingChannel: "webchat"
    cfg,
    dispatcher,
    replyOptions: {
      runId: clientRunId,
      abortSignal: abortController.signal,
      onAgentRunStart: (runId) => {
        agentRunStarted = true;
        // Register for tool events if client exists
        const connId = typeof client?.connId === "string" ? client.connId : undefined;
        if (connId && hasGatewayClientCap(client?.connect?.caps, GATEWAY_CLIENT_CAPS.TOOL_EVENTS)) {
          context.registerToolEventRecipient(runId, connId);
        }
      },
      onModelSelected,
    },
  })
    .then(() => {
      if (!agentRunStarted) {
        // No agent run → build reply from finalReplyParts
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
        // Broadcast final message + enqueue push
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
      broadcastChatError({
        context,
        runId: clientRunId,
        sessionKey: rawSessionKey,
        errorMessage: String(err),
      });
    })
    .finally(() => {
      context.chatAbortControllers.delete(clientRunId);
    });
};
```

---

## Dispatch: Route Check (dispatch-from-config.ts:200-295)

### The Critical Check

```typescript
export async function dispatchReplyFromConfig(params: {
  ctx: FinalizedMsgContext;
  cfg: ShittimChestConfig;
  dispatcher: ReplyDispatcher;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof getReplyFromConfig;
}): Promise<DispatchFromConfigResult> {
  const { ctx, cfg, dispatcher } = params;

  // ... log setup ...

  const originatingChannel = ctx.OriginatingChannel; // ← "webchat"
  const originatingTo = ctx.OriginatingTo; // ← undefined
  const currentSurface = (ctx.Surface ?? ctx.Provider)?.toLowerCase(); // ← "webchat"

  // ← THIS IS THE CRITICAL DECISION
  const shouldRouteToOriginating = Boolean(
    isRoutableChannel(originatingChannel) && // isRoutableChannel("webchat") → FALSE
    originatingTo && // undefined → FALSE
    originatingChannel !== currentSurface, // Would be true, but doesn't matter
  );

  // isRoutableChannel checks:
  // if (!channel || channel === INTERNAL_MESSAGE_CHANNEL) return false;
  // So "webchat" → FALSE immediately

  // Result: shouldRouteToOriginating = FALSE
  // Message will NOT be routed to external channels

  // ... continue processing locally ...
}
```

### What Happens If Message IS Routable

```typescript
// Only called if shouldRouteToOriginating === true
const sendPayloadAsync = async (
  payload: ReplyPayload,
  abortSignal?: AbortSignal,
  mirror?: boolean,
): Promise<void> => {
  if (!originatingChannel || !originatingTo) {
    return;
  }
  if (abortSignal?.aborted) {
    return;
  }
  const result = await routeReply({
    payload,
    channel: originatingChannel, // Would be "telegram", "discord", etc.
    to: originatingTo, // Would be user/channel ID
    sessionKey: ctx.SessionKey,
    accountId: ctx.AccountId,
    threadId: ctx.MessageThreadId,
    cfg,
    abortSignal,
    mirror,
  });
  // ... handle result ...
};

// For proactive: this is NEVER called because shouldRouteToOriginating = false
```

---

## Streaming: Agent Events → Deltas (server-chat.ts:280-368)

### Delta Emission (streamed to WebSocket clients every 50ms)

```typescript
const emitChatDelta = (
  sessionKey: string, // ← "proactive"
  clientRunId: string, // ← runId from chat.send
  sourceRunId: string, // ← source agent runId
  seq: number, // ← sequence number
  text: string, // ← streamed text chunk
) => {
  // 1. Clean up directive tags
  const cleaned = stripInlineDirectiveTagsForDisplay(text).text;
  if (!cleaned) return;

  // 2. Skip silent replies
  if (isSilentReplyText(cleaned, SILENT_REPLY_TOKEN)) return;

  // 3. Buffer the text
  chatRunState.buffers.set(clientRunId, cleaned);

  // 4. Hide heartbeat output if configured
  if (shouldHideHeartbeatChatOutput(clientRunId, sourceRunId)) return;

  // 5. Throttle: only send every 50ms minimum
  const now = Date.now();
  const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;
  if (now - last < 50) return;

  chatRunState.deltaSentAt.set(clientRunId, now);

  // 6. Build delta payload
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

  // 7. Broadcast to all WebSocket clients
  broadcast("chat", payload, { dropIfSlow: true }); // ← Drop if buffers full

  // 8. Send to node subscribers (for channel forwarding)
  nodeSendToSession(sessionKey, "chat", payload);
};
```

### Final Emission + Push Enqueue

```typescript
const emitChatFinal = (
  sessionKey: string, // ← "proactive"
  clientRunId: string,
  sourceRunId: string,
  seq: number,
  jobState: "done" | "error",
  error?: unknown,
) => {
  // 1. Get buffered text
  const bufferedText = stripInlineDirectiveTagsForDisplay(
    chatRunState.buffers.get(clientRunId) ?? "",
  ).text.trim();

  // 2. Normalize heartbeat text
  const normalizedHeartbeatText = normalizeHeartbeatChatFinalText({
    runId: clientRunId,
    sourceRunId,
    text: bufferedText,
  });

  const text = normalizedHeartbeatText.text.trim();
  const shouldSuppressSilent =
    normalizedHeartbeatText.suppress || isSilentReplyText(text, SILENT_REPLY_TOKEN);

  // 3. Clean up buffers
  chatRunState.buffers.delete(clientRunId);
  chatRunState.deltaSentAt.delete(clientRunId);

  if (jobState === "done") {
    // 4. Build final payload
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "final", // ← FINAL STATE
      message:
        text && !shouldSuppressSilent
          ? {
              role: "assistant",
              content: [{ type: "text", text }],
              timestamp: Date.now(),
            }
          : undefined,
    };

    // 5. Broadcast to WebSocket clients
    broadcast("chat", payload);

    // 6. Send to node subscribers
    nodeSendToSession(sessionKey, "chat", payload);

    return;
  }

  // ... error case ...
};
```

### Push Enqueue in broadcastChatFinal (chat.ts)

```typescript
function broadcastChatFinal(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession" | "agentRunSeq">;
  runId: string;
  sessionKey: string;
  message?: Record<string, unknown>;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const strippedEnvelopeMessage = stripEnvelopeFromMessage(params.message) as
    | Record<string, unknown>
    | undefined;
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    seq,
    state: "final" as const,
    message: stripInlineDirectiveTagsFromMessageForDisplay(strippedEnvelopeMessage),
  };

  // ← ENQUEUE PUSH NOTIFICATION
  try {
    const contentArr = Array.isArray(params.message?.content) ? params.message?.content : [];
    const textChunks = contentArr
      .filter((c: any) => c && c.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text);
    const bodyInfo = textChunks.join("\n").trim();
    if (bodyInfo) {
      enqueuePush({ title: "Arona", body: bodyInfo }); // ← TO iOS QUEUE
    }
  } catch {
    // disregard parse errors for push
  }

  // Broadcast to WebSocket clients
  params.context.broadcast("chat", payload);
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
  params.context.agentRunSeq.delete(params.runId);
}
```

---

## Push Queue: In-Memory Queue (pending-store.ts)

```typescript
const queue: PendingMessage[] = [];

export function enqueuePush(msg: { title: string; body: string }): void {
  queue.push({
    title: msg.title,
    body: msg.body,
    queuedAt: new Date().toISOString(),
  });
  flushWaiters(); // ← Wake any long-poll connections
}

/** Drain all pending messages (called by iOS app) */
export function drainPending(): PendingMessage[] {
  return queue.splice(0); // Remove and return all
}

/** Long-poll: wait for messages (up to timeoutMs) */
export function waitForPending(timeoutMs: number = 25000): Promise<PendingMessage[]> {
  if (queue.length > 0) {
    return Promise.resolve(drainPending());
  }

  return new Promise<PendingMessage[]>((resolve) => {
    const timer = setTimeout(() => {
      const idx = waiters.findIndex((w) => w.resolve === resolve);
      if (idx >= 0) waiters.splice(idx, 1);
      resolve(drainPending());
    }, timeoutMs);

    waiters.push({ resolve, timer });
  });
}

function flushWaiters(): void {
  if (waiters.length === 0) return;
  const msgs = drainPending();
  const toNotify = waiters.splice(0);
  for (const w of toNotify) {
    clearTimeout(w.timer);
    w.resolve(msgs); // ← Wake them up with messages
  }
}
```

---

## HTTP Endpoints: iOS App Polling (push-handler.ts)

```typescript
// POST /arona/push/register
// iOS app registers for push notifications
if (subPath === "register" && req.method === "POST") {
  const { token, platform, bundleId } = /* parse body */;
  if (platform === "apns") {
    registerToken(token, "apns", bundleId ?? "com.furiri.Arona-AI");
  }
  sendJson(res, 200, { ok: true });
  return true;
}

// GET /arona/push/pending
// iOS BGAppRefreshTask calls this; drains queue
if (subPath === "pending" && req.method === "GET") {
  const messages = drainPending();  // ← Get and clear queue
  const mood = getMoodSnapshot();
  sendJson(res, 200, { ok: true, messages, mood });
  return true;
}

// GET /arona/push/long-poll
// Holds connection open; wakes when message arrives
if (subPath === "long-poll" && req.method === "GET") {
  const timeoutParam = url.searchParams.get("timeout");
  const timeoutMs = Math.min(Math.max(Number(timeoutParam) || 25000, 1000), 25000);

  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  const messages = await waitForPending(timeoutMs);  // ← Wait for enqueuePush()
  if (!aborted) {
    const mood = getMoodSnapshot();
    sendJson(res, 200, { ok: true, messages, mood });
  }
  return true;
}
```

---

## Summary: Data Flow

```
SCHEDULER FIRES
  ↓
onTrigger({ prompt: "[System]...", windowKey: "morning" })
  ↓
INVOKE chat.send HANDLER
  sessionKey: "proactive"
  message: prompt
  context: gCtxOffline
  ↓
CREATE MESSAGE CONTEXT
  ctx.OriginatingChannel = "webchat"    ← INTERNAL
  ctx.OriginatingTo = undefined
  ↓
DISPATCH INBOUND MESSAGE
  dispatchReplyFromConfig(ctx, cfg, dispatcher)
    ↓
    Check: shouldRouteToOriginating =
      isRoutableChannel("webchat") &&   ← FALSE!
      originatingTo &&                  ← undefined
      "webchat" !== "webchat"           ← false
    ↓
    Result: shouldRouteToOriginating = FALSE
    ↓
    PROCESS LOCALLY (no channel routing)
    ↓
    AGENT GENERATES REPLY
      ↓
      emit events with stream="assistant"
      ↓
      emitChatDelta → broadcast("chat", delta)  ← To WebSocket clients
      ↓
      emitChatFinal → broadcast("chat", final)  ← To WebSocket clients
                   → enqueuePush(...)           ← To iOS queue
  ↓
STORE IN TRANSCRIPT
  appendAssistantTranscriptMessage()  ← saves to "proactive" session
  ↓
BROADCAST FINAL
  broadcastChatFinal()
    → broadcast("chat", payload)      ← To WebSocket clients
    → nodeSendToSession()             ← To node subscribers
    → enqueuePush()                   ← To iOS queue
  ↓
iOS APP POLLS
  GET /arona/push/pending or /arona/push/long-poll
    ↓
    drainPending() or waitForPending()
    ↓
    returns: { messages: [...], mood: {...} }
    ↓
  Display notification
```

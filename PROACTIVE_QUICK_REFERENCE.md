# Arona Proactive System — Quick Reference

## The Question: Why don't proactive messages reach Discord/Telegram?

## The Answer: By Design

Proactive messages use `OriginatingChannel: "webchat"` (internal channel) which **cannot route to external channels**. The system checks:

```typescript
shouldRouteToOriginating =
  isRoutableChannel(originatingChannel) && // ← "webchat" → FALSE
  originatingTo && // ← undefined
  originatingChannel !== currentSurface;
```

Since `isRoutableChannel("webchat")` returns **FALSE**, the message stays internal.

---

## Full Flow at a Glance

```
TRIGGER
├─ Scheduler fires at random time (5:30-7:30, 11:30-13:00, 20:00-22:30, 23:00-00:30)
└─ Random nudge: 2.5-5 hours during waking hours

SEND
├─ Handler: chat.send(sessionKey="proactive", message="[System] Vietnamese prompt")
├─ Context: OriginatingChannel="webchat" (INTERNAL ONLY)
└─ No WebSocket client connection (gCtxOffline)

PROCESS
├─ Agent generates reply
├─ Stream deltas every 50ms to WebSocket clients (broadcast)
├─ Store in "proactive" session transcript
└─ Enqueue iOS push notification

DELIVERY
├─ WebSocket: Sent to all connected clients (if listening)
├─ iOS push: ✓ ALWAYS enqueued
├─ Discord: ✗ NOT routed (internal channel)
├─ Telegram: ✗ NOT routed (internal channel)
└─ Email: ✗ NOT routed (not supported for proactive)

RESULT
└─ Message appears in:
   ├─ iOS app (via push notification)
   ├─ WebSocket clients dashboard (live)
   └─ "proactive" session transcript
```

---

## Key Files

| File                                           | Purpose                                     |
| ---------------------------------------------- | ------------------------------------------- |
| `src/arona/proactive/scheduler.ts`             | Timer logic + random windows                |
| `src/gateway/server.impl.ts:898-935`           | Wiring: scheduler → chat.send               |
| `src/gateway/server-methods/chat.ts:688-998`   | chat.send handler                           |
| `src/auto-reply/reply/dispatch-from-config.ts` | Routing decision (shouldRouteToOriginating) |
| `src/gateway/server-chat.ts:250-500`           | Agent event handler → delta streaming       |
| `src/arona/push/push-handler.ts`               | iOS push HTTP endpoints                     |
| `src/arona/push/pending-store.ts`              | In-memory push queue                        |

---

## Critical Decision Point: `shouldRouteToOriginating`

**Location:** `src/auto-reply/reply/dispatch-from-config.ts` (around line 200)

```typescript
const shouldRouteToOriginating = Boolean(
  isRoutableChannel(originatingChannel) && // What channel?
  originatingTo && // To whom?
  originatingChannel !== currentSurface, // Is it different?
);
```

### For Proactive Messages:

- `originatingChannel` = `"webchat"`
- `isRoutableChannel("webchat")` → **FALSE** ✗
- Result: `shouldRouteToOriginating = false` → **Message stays internal**

### For User Messages from Telegram:

- `originatingChannel` = `"telegram"`
- `originatingTo` = `chat_id` (defined)
- `isRoutableChannel("telegram")` → **TRUE** ✓
- Result: Can route back to originating channel or other channels

---

## Debugging: Is Your Proactive Message Working?

### 1. Did the scheduler fire?

```bash
cat ~/.shittimchest/workspace/.arona/proactive-log.json | tail -5
```

Expected output for morning window:

```json
{
  "timestamp": "2026-04-07T06:45:00Z",
  "windowKey": "morning",
  "success": true,
  "scheduledFor": "2026-04-08T06:32:00Z"
}
```

### 2. Did the handler execute?

```bash
grep "\[Proactive\]" ~/.shittimchest/workspace/logs/gateway.log | tail -5
```

Expected: `[Proactive] Firing window="morning"...`

### 3. Is the session transcript updated?

```bash
cat ~/.shittimchest/workspace/sessions/proactive.json 2>/dev/null | jq '.messages | .[-1]'
```

Expected: Last message from the session

### 4. Are push notifications queued?

```bash
curl -s http://localhost:8888/arona/push/tokens \
  -H "Authorization: Bearer $(cat ~/.shittimchest/workspace/gateway-token.txt)" | jq '.pendingCount'
```

Expected: > 0 if messages are pending

### 5. Is the iOS app polling?

```bash
grep "long-poll\|pending" ~/.shittimchest/workspace/logs/gateway.log | tail -3
```

Expected: `GET /arona/push/pending` or `GET /arona/push/long-poll`

---

## What Proactive Messages CANNOT Do

| Feature               | Support | Why                             |
| --------------------- | ------- | ------------------------------- |
| Route to Discord      | ✗       | Internal channel → not routable |
| Route to Telegram     | ✗       | Internal channel → not routable |
| Route to email        | ✗       | Internal channel → not routable |
| Route to Slack        | ✗       | Internal channel → not routable |
| Send to team channels | ✗       | No OriginatingTo target         |
| Reach external APIs   | ✗       | Closed loop (local only)        |

## What Proactive Messages CAN Do

| Feature                 | Support | Where             |
| ----------------------- | ------- | ----------------- |
| Reach iOS app           | ✓       | Push notification |
| Stream to dashboard     | ✓       | WebSocket clients |
| Save to transcript      | ✓       | Session storage   |
| Trigger mood changes    | ✓       | Mood system       |
| Show in session history | ✓       | UI                |

---

## The Architecture: Why This Design?

**Proactive messages are personal & local:**

- Not meant for team channels (Discord, Slack)
- Not meant for external distribution (email, webhooks)
- Designed for the **user's personal AI companion**
- Delivered locally via iOS app + dashboard

**User messages can route to channels because:**

- They originate from a real user on a real channel
- They have `OriginatingChannel` and `OriginatingTo` set
- The system can route back to that channel or others
- Example: Telegram user → reply → Discord channel (if configured)

---

## To Verify Everything Works

1. **Check scheduler:**

   ```bash
   ls -lh ~/.shittimchest/workspace/.arona/proactive-log.json
   ```

   Should exist and be recently modified

2. **Check logs for errors:**

   ```bash
   grep -i "error\|warn" ~/.shittimchest/workspace/logs/gateway.log | grep -i proactive
   ```

   Should be empty or minimal

3. **Check iOS app:**
   - Open the Arona iOS app
   - Ensure it's registered: Settings → Notifications → Check status
   - Enable background app refresh (Settings → General → Background App Refresh)
   - Wait for scheduled window (or restart app to trigger test)

4. **Manual test:**
   ```bash
   curl -X POST http://localhost:8888/gateway \
     -H "Content-Type: application/json" \
     -d '{
       "method": "chat.send",
       "params": {
         "sessionKey": "proactive",
         "message": "Test message",
         "idempotencyKey": "test-'"$(date +%s)"'"
       }
     }'
   ```

---

## Summary

| Component          | Behavior                           |
| ------------------ | ---------------------------------- |
| **Trigger**        | Random time within daily windows   |
| **Session**        | Fixed to "proactive"               |
| **Channel**        | "webchat" (internal only)          |
| **Routing**        | No external routing (by design)    |
| **Streaming**      | Yes (WebSocket deltas every 50ms)  |
| **Push**           | Yes (iOS queue)                    |
| **Transcript**     | Yes (saved to "proactive" session) |
| **Cross-Platform** | iOS + local dashboard only         |

**Bottom line:** Proactive messages are for your personal AI companion, not team channels.

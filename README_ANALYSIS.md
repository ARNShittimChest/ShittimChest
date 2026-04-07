# Arona Proactive System Analysis — Complete Documentation

This analysis provides a comprehensive, thorough examination of the Arona gateway server's proactive messaging system, streaming architecture, and cross-platform delivery mechanisms.

## 📋 Documentation Files

### 1. **PROACTIVE_SYSTEM_ANALYSIS.md** (21 KB, 659 lines)

**Start here for the complete deep dive**

Comprehensive 10-part analysis covering:

- **Part 1:** Proactive Scheduler Flow & Random Time Windows
- **Part 2:** Gateway Wiring (scheduler → chat.send)
- **Part 3:** chat.send Handler Implementation
- **Part 4:** Auto-Reply Dispatch & Channel Routing Logic
- **Part 5:** Streaming Text to WebSocket Clients
- **Part 6:** iOS Push Notification Delivery
- **Part 7:** Why Messages DON'T Route to Discord/Telegram
- **Part 8:** Silent Failure Diagnosis & Debugging
- **Part 9:** Full Message Flow Diagram
- **Part 10:** Summary Table

**Best for:** Understanding the full architecture end-to-end

---

### 2. **PROACTIVE_QUICK_REFERENCE.md** (6.8 KB, 224 lines)

**Quick facts & debugging guide**

Condensed reference containing:

- The critical routing decision (`shouldRouteToOriginating`)
- Flow diagram at a glance
- Key files table with line numbers
- 5-step debugging checklist
- Can/Cannot do table
- Why this architectural design
- Manual testing commands

**Best for:** Quick lookups and debugging

---

### 3. **PROACTIVE_CODE_MAP.md** (18 KB, 637 lines)

**Line-by-line code walkthrough**

Detailed code maps with full source:

1. **Scheduler Entry Point** (scheduler.ts:258-270)
2. **Window Scheduling** (scheduler.ts:186-213)
3. **Gateway Wiring** (server.impl.ts:898-935)
4. **chat.send Handler** (chat.ts:688-998)
5. **Route Decision** (dispatch-from-config.ts:~200)
6. **Delta Emission** (server-chat.ts:280-368)
7. **Final Emission** (server-chat.ts:319-368)
8. **Push Enqueueing** (chat.ts + pending-store.ts)
9. **HTTP Endpoints** (push-handler.ts)
10. **Complete Data Flow**

**Best for:** Code-level understanding and implementation details

---

### 4. **VISUAL_SUMMARY.txt** (17 KB, 297 lines)

**ASCII diagrams & visual flow charts**

Visual representations:

- 10-step scheduler → iOS delivery flow diagram
- Routing decision tree (proactive vs. user messages)
- Delivery channel summary
- File involvement map
- Key metrics table

**Best for:** Visual learners and high-level overview

---

### 5. **ANALYSIS_COMPLETE.txt** (13 KB, 373 lines)

**Executive summary & checklist**

Contains:

- Key findings summary
- Architecture overview
- File structure index
- Critical decision point explanation
- Data flow diagram
- Streaming mechanics
- Push notification flow
- Debugging checklist (7 items)
- Summary table
- Conclusion

**Best for:** Quick summary and management overview

---

## 🎯 Quick Answers

### Q: Why don't proactive messages reach Discord/Telegram?

**A:** By design. They use `OriginatingChannel: "webchat"` (internal channel) which **cannot route** to external channels. The routing check at `src/auto-reply/reply/dispatch-from-config.ts:~200` explicitly blocks internal channels.

### Q: How often do proactive messages fire?

**A:** 5 times daily:

- Morning: 5:30-7:30 (random)
- Lunch: 11:30-13:00 (random)
- Evening: 20:00-22:30 (random)
- Late-night: 23:00-00:30 (random)
- Nudges: 2.5-5 hours apart (6 AM-10 PM only)

### Q: Where do proactive messages go?

**A:** Only to:

1. ✓ iOS push notifications (always enqueued)
2. ✓ WebSocket clients (if connected)
3. ✓ "proactive" session transcript (saved)

NOT to: Discord, Telegram, email, or external channels

### Q: How is streaming implemented?

**A:** Via `emitChatDelta()` which:

- Throttles to 50ms intervals
- Broadcasts to all WebSocket clients
- Can drop messages if buffers fill (`dropIfSlow: true`)
- Sent via `broadcast("chat", delta)` and `nodeSendToSession()`

### Q: What if my proactive message doesn't appear?

**A:** Check:

1. Scheduler fired? → Check `~/.shittimchest/workspace/.arona/proactive-log.json`
2. Handler executed? → Grep for `[Proactive]` in gateway logs
3. Session updated? → Check `sessions/proactive.json` has recent message
4. Push queued? → Check `/arona/push/tokens` endpoint
5. iOS app polling? → Look for `/arona/push/pending` or `/long-poll` requests

See **PROACTIVE_QUICK_REFERENCE.md** for full debugging commands.

---

## 🗺️ Navigation by Use Case

### I need to understand the full flow

→ Read **PROACTIVE_SYSTEM_ANALYSIS.md** (10 comprehensive parts)

### I need to debug a problem

→ Read **PROACTIVE_QUICK_REFERENCE.md** (5-step debugging checklist)

### I need to understand the code

→ Read **PROACTIVE_CODE_MAP.md** (line-by-line walkthroughs)

### I need a quick visual overview

→ Read **VISUAL_SUMMARY.txt** (ASCII diagrams)

### I need to brief someone

→ Read **ANALYSIS_COMPLETE.txt** (executive summary)

---

## 📍 Critical Code Locations

| What                            | File                                           | Lines   |
| ------------------------------- | ---------------------------------------------- | ------- |
| Scheduler                       | `src/arona/proactive/scheduler.ts`             | 258-270 |
| Gateway wiring                  | `src/gateway/server.impl.ts`                   | 898-935 |
| chat.send handler               | `src/gateway/server-methods/chat.ts`           | 688-998 |
| **Routing decision** (CRITICAL) | `src/auto-reply/reply/dispatch-from-config.ts` | ~200    |
| Delta streaming                 | `src/gateway/server-chat.ts`                   | 280-368 |
| Push enqueueing                 | `src/gateway/server-methods/chat.ts`           | 510-522 |
| Push queue                      | `src/arona/push/pending-store.ts`              | All     |
| iOS endpoints                   | `src/arona/push/push-handler.ts`               | All     |

---

## 📊 File Statistics

| Document                     | Size       | Lines     | Purpose                    |
| ---------------------------- | ---------- | --------- | -------------------------- |
| PROACTIVE_SYSTEM_ANALYSIS.md | 21 KB      | 659       | Complete deep dive         |
| PROACTIVE_QUICK_REFERENCE.md | 6.8 KB     | 224       | Quick facts & debugging    |
| PROACTIVE_CODE_MAP.md        | 18 KB      | 637       | Code walkthroughs          |
| VISUAL_SUMMARY.txt           | 17 KB      | 297       | ASCII diagrams             |
| ANALYSIS_COMPLETE.txt        | 13 KB      | 373       | Executive summary          |
| **Total**                    | **~76 KB** | **2,190** | **Complete documentation** |

---

## 🔍 Key Findings

### 1. **Messages Are Internal By Design**

Proactive messages use `OriginatingChannel: "webchat"` which is marked as non-routable. This is intentional — proactive messages are for personal AI companion notifications, not team broadcasting.

### 2. **Streaming Is Throttled**

Delta messages are sent every 50ms minimum to WebSocket clients. Messages can be dropped if buffers fill (`dropIfSlow: true`).

### 3. **iOS Push Is Always Enqueued**

Every proactive message automatically enqueues a push notification. The iOS app polls at 15-30 min intervals or uses long-poll for near-instant delivery.

### 4. **The Gateway Works Offline**

Proactive messages are sent via `gCtxOffline` context with no WebSocket client. They're fire-and-forget async operations.

### 5. **Messages Are Saved**

All proactive messages are stored in the "proactive" session transcript for history and debugging.

---

## 🛠️ For Developers

### To Add New Proactive Window

Edit `src/arona/proactive/scheduler.ts`:

```typescript
const TIME_WINDOWS: TimeWindow[] = [
  // ... existing windows
  {
    key: "my-window",
    startHour: 14.0, // 2 PM
    endHour: 15.0, // 3 PM
    includeWeather: true,
    buildPrompt: (weather) => `[System] My custom prompt${weather}...`,
  },
];
```

### To Route Proactive to External Channels

Modify the channel check in `src/auto-reply/reply/dispatch-from-config.ts`:

```typescript
// Current: proactive messages blocked (returns FALSE)
// To enable: change isRoutableChannel or add special case for proactive
```

**Warning:** This is intentional architectural design. Changing it may break the intended user experience.

### To Change Push Queue Behavior

Edit `src/arona/push/pending-store.ts`:

- Add persistence (currently in-memory only)
- Change queue limits
- Modify polling behavior

---

## 📚 Related Documentation

- **Session System:** `src/config/sessions.ts`
- **Agent Events:** `src/infra/agent-events.ts`
- **WebSocket Broadcast:** `src/gateway/server.impl.ts` (broadcast method)
- **Channels Registry:** `src/channels/registry.ts`
- **Message Context:** `src/auto-reply/templating.ts`

---

## ✅ Verification Checklist

- [x] Read scheduler implementation
- [x] Understand gateway wiring
- [x] Review chat.send handler
- [x] Traced routing decision
- [x] Examined streaming mechanics
- [x] Analyzed push delivery
- [x] Verified cross-platform behavior
- [x] Documented silent failure scenarios
- [x] Created debugging guide

---

## 📝 Analysis Metadata

- **Created:** 2026-04-07
- **Analyzed Codebase:** `/Volumes/OCungRoi/PRJ/Arona-CLW`
- **Files Examined:** 8 core files (~2,500 LOC)
- **Total Documentation:** ~2,190 lines across 5 files
- **Coverage:** Scheduler → Gateway → Routing → Streaming → Push → iOS

---

## 🎓 Learning Path

**Beginner:** Start with VISUAL_SUMMARY.txt, then ANALYSIS_COMPLETE.txt

**Intermediate:** Read PROACTIVE_QUICK_REFERENCE.md, focus on the routing decision

**Advanced:** Deep dive into PROACTIVE_SYSTEM_ANALYSIS.md with PROACTIVE_CODE_MAP.md side-by-side

**Expert:** Review source code in this order:

1. scheduler.ts (understand triggers)
2. server.impl.ts:898-935 (understand wiring)
3. chat.ts:688-998 (understand handler)
4. dispatch-from-config.ts:~200 (understand routing decision)
5. server-chat.ts (understand streaming)
6. pending-store.ts (understand push queue)

---

## Questions?

Refer to the specific document:

- **"Why don't my proactive messages appear?"** → PROACTIVE_QUICK_REFERENCE.md (debugging section)
- **"How does streaming work?"** → PROACTIVE_SYSTEM_ANALYSIS.md (Part 5)
- **"What's the code flow?"** → PROACTIVE_CODE_MAP.md (complete walkthrough)
- **"Why this architecture?"** → ANALYSIS_COMPLETE.txt (conclusion) or PROACTIVE_QUICK_REFERENCE.md (why this design)

---

**All analysis documents are located in:**

```
/Volumes/OCungRoi/PRJ/Arona-CLW/
├── PROACTIVE_SYSTEM_ANALYSIS.md
├── PROACTIVE_QUICK_REFERENCE.md
├── PROACTIVE_CODE_MAP.md
├── VISUAL_SUMMARY.txt
├── ANALYSIS_COMPLETE.txt
└── README_ANALYSIS.md (this file)
```

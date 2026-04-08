# iOS Health Architecture Diagram

## Current Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         iOS DEVICE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐                                            │
│  │  Core Motion     │                                            │
│  │  (Hardware)      │                                            │
│  │                  │                                            │
│  │ - Pedometer      │                                            │
│  │ - Motion Sensor  │                                            │
│  │ - Accelerometer  │                                            │
│  └────────┬─────────┘                                            │
│           │                                                      │
│           │ (Steps, Distance, Activity)                          │
│           ↓                                                      │
│  ┌──────────────────────────────────────────┐                   │
│  │  Motion Service (MotionService.swift)    │                   │
│  │  - pedometer()                           │                   │
│  │  - activities()                          │                   │
│  └────────┬─────────────────────────────────┘                   │
│           │                                                      │
│           │ (Queries on-demand)                                  │
│           ↓                                                      │
│  ┌──────────────────────────────────────────┐                   │
│  │ NodeAppModel.handleMotionInvoke()        │                   │
│  │ - Routes motion.pedometer                │                   │
│  │ - Routes motion.activity                 │                   │
│  └────────┬─────────────────────────────────┘                   │
│           │                                                      │
│           │ (BridgeInvokeResponse JSON)                          │
│           ↓                                                      │
│  ┌──────────────────────────────────────────┐                   │
│  │ NodeCapabilityRouter                     │                   │
│  │ - Routes commands to handlers            │                   │
│  │ - Returns JSON responses                 │                   │
│  └────────┬─────────────────────────────────┘                   │
│           │                                                      │
└───────────┼──────────────────────────────────────────────────────┘
            │ (Local Network / Gateway Protocol)
            │ ❌ Step data NOT sent to backend
            │    (No code calls /arona/push/health)
            ↓
┌─────────────────────────────────────────────────────────────────┐
│                     GATEWAY / BACKEND                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────┐                   │
│  │ Push Handler (/arona/push/health)       │                   │
│  │ - Accepts POST with { steps: number }  │                   │
│  │ - Auth: Gateway token required         │                   │
│  │ - Calls: updateSteps(steps)            │                   │
│  └────────┬────────────────────────────────┘                   │
│           │ ❌ NEVER RECEIVES DATA FROM iOS                    │
│           ↓                                                      │
│  ┌─────────────────────────────────────────┐                   │
│  │ Health Config (health-config.ts)        │                   │
│  │ - Stores: latestSteps (in memory)       │                   │
│  │ - File: .arona/health-config.json       │                   │
│  │ - Water, Eyes, Movement, Sleep configs  │                   │
│  └────────┬────────────────────────────────┘                   │
│           │                                                      │
│           │ (Queries steps, reads config)                        │
│           ↓                                                      │
│  ┌─────────────────────────────────────────┐                   │
│  │ Health Scheduler (health-scheduler.ts)  │                   │
│  │ - Every N minutes: fire reminder        │                   │
│  │ - LLM generates Arona voice message     │                   │
│  │ - Injects step count into prompt        │                   │
│  │ - Falls back to pre-written templates   │                   │
│  └────────┬────────────────────────────────┘                   │
│           │ (notification text)                                  │
│           ↓                                                      │
│  ┌─────────────────────────────────────────┐                   │
│  │ Push Delivery (pending-store.ts)        │                   │
│  │ - Enqueue to pending message queue      │                   │
│  │ - iOS BGAppRefresh drains queue         │                   │
│  │ - Watch notification mirror            │                   │
│  └────────┬────────────────────────────────┘                   │
│           │ (queued messages)                                    │
└───────────┼──────────────────────────────────────────────────────┘
            │ (Long-poll / BGAppRefresh)
            │
            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    iOS APP (Again)                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐                    │
│  │ Push Notification Received             │                    │
│  │ - Title: "💧 Nhắc uống nước"           │                    │
│  │ - Body: "Sensei~! Uống nước đi nè~..."│                    │
│  │ - Also mirrored to Watch               │                    │
│  └────────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Missing: Step Data Sync Path (What SHOULD Happen)

```
┌─────────────────────────────────────────────────────────────────┐
│                         iOS DEVICE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐                                            │
│  │  Core Motion     │                                            │
│  │  (Hardware)      │                                            │
│  │                  │                                            │
│  │ - Step Count: 8234                                           │
│  │ - Distance: 6.2 km                                           │
│  │ - Floors: 12 up, 11 down                                     │
│  └────────┬─────────┘                                            │
│           │                                                      │
│           ↓                                                      │
│  ┌──────────────────────────────────────────┐                   │
│  │ ❌ MISSING: Health Sync Service          │                   │
│  │ - Query pedometer daily / on-demand      │                   │
│  │ - Store locally: last sync time          │                   │
│  │ - POST to /arona/push/health             │                   │
│  │ - Update UI: "Steps: 8234"               │                   │
│  └────────┬─────────────────────────────────┘                   │
│           │                                                      │
│           │ POST { steps: 8234 }                                 │
│           │ Authorization: Bearer <token>                        │
│           ↓                                                      │
└───────────┼──────────────────────────────────────────────────────┘
            │
            ↓
        GATEWAY
            │
            ↓
        /arona/push/health
            │
            ├─→ updateSteps(8234)
            │
            └─→ Stored in memory for health-scheduler
                │
                ↓
            Movement Reminder (next fire)
                │
                ├─→ Query: latestSteps = 8234
                │
                ├─→ LLM Prompt Injection:
                │   "Hôm nay Sensei đã đi được 8234 bước."
                │
                └─→ LLM-generated: "Wow! Bạn đã đi 8234 bước
                                   hôm nay! Rất tuyệt vời! 🎉"
```

---

## Current Settings UI Structure

```
SETTINGS TAB
│
├─ GATEWAY
│  ├─ Setup Code (text field)
│  ├─ Connection Status
│  ├─ Server Name / Address
│  ├─ Auto-connect (toggle)
│  ├─ Manual Gateway (advanced)
│  └─ Discovery Debug Logs
│
└─ DEVICE
   ├─ FEATURES
   │  ├─ Voice Wake (toggle + wake words config)
   │  ├─ Talk Mode (toggle + voice settings)
   │  ├─ Background Listening (toggle)
   │  ├─ Allow Camera (toggle)
   │  ├─ Location Access (segmented: Off/While Using/Always)
   │  ├─ Prevent Sleep (toggle)
   │  ├─ Talk Button (toggle)
   │  ├─ Default Share Instruction (text area)
   │  └─ Run Share Self-Test (button)
   │
   └─ DEVICE INFO
      ├─ Display Name (text field)
      ├─ Instance ID (label)
      ├─ Device (label)
      ├─ Platform (label)
      └─ ShittimChest Version (label)
```

### ❌ MISSING: HEALTH SECTION

Should add:

```
SETTINGS TAB
│
├─ GATEWAY
│  └─ (existing)
│
├─ DEVICE
│  ├─ FEATURES (existing)
│  ├─ HEALTH ← NEW SECTION
│  │  ├─ Motion Permission Status
│  │  │  ├─ 🟢 Authorized / 🔴 Denied / ⚪ Not Requested
│  │  │  └─ [Request Permission] (button if not authorized)
│  │  │
│  │  ├─ Today's Steps
│  │  │  ├─ Label: "Steps Today: 8,234"
│  │  │  ├─ Last Synced: "3 hours ago"
│  │  │  └─ [Sync Now] (button)
│  │  │
│  │  ├─ REMINDERS (disclosure group)
│  │  │  ├─ Water Reminder
│  │  │  │  ├─ (toggle) Enable / Disable
│  │  │  │  ├─ Interval: 120 min [slider 5-1440]
│  │  │  │  └─ Active: 7:00 AM - 10:00 PM
│  │  │  │
│  │  │  ├─ Eye Break Reminder
│  │  │  │  ├─ (toggle) Enable / Disable
│  │  │  │  ├─ Interval: 45 min [slider]
│  │  │  │  └─ Active: 7:00 AM - 11:00 PM
│  │  │  │
│  │  │  ├─ Movement Reminder
│  │  │  │  ├─ (toggle) Enable / Disable
│  │  │  │  ├─ Interval: 180 min [slider]
│  │  │  │  ├─ Active: 7:00 AM - 10:00 PM
│  │  │  │  └─ [Edit Custom Schedule]
│  │  │  │
│  │  │  └─ Sleep Reminder
│  │  │     ├─ (toggle) Enable / Disable
│  │  │     └─ Time: 11:00 PM
│  │  │
│  │  └─ ADVANCED
│  │     ├─ Health Data Sync
│  │     │  ├─ Status: "Last synced 3 hours ago"
│  │     │  ├─ Frequency: "Daily" [dropdown]
│  │     │  └─ [Force Sync] (button)
│  │     │
│  │     └─ HealthKit Integration (future)
│  │        ├─ Read Health Data (toggle)
│  │        ├─ Include: Steps, Heart Rate, Sleep
│  │        └─ [Request Permission]
│  │
│  └─ DEVICE INFO (existing)
```

---

## Health Reminder Notification Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                   Health Scheduler                               │
│                  (backend, every N min)                          │
└──────────┬───────────────────────────────────────────────────────┘
           │
           ├─ Is reminder enabled? ✓
           ├─ Is it active hours? ✓
           ├─ Has enough time passed since last fire? ✓
           │
           ├─→ Try LLM Generation
           │   │
           │   ├─→ Resolve model (agent's default)
           │   ├─→ Build LLM prompt
           │   ├─→ Call API with high temperature (0.9)
           │   │
           │   └─ On success: Generated text
           │      On failure: Use fallback
           │
           ├─→ Fallback Pre-written Templates
           │   │
           │   ├─ Template 1: "Sensei~! Uống nước đi nè~..."
           │   ├─ Template 2: "Munya~! Sensei ơi uống nước đi..."
           │   ├─ Template 3: "Sensei! Đã đến lúc uống nước..."
           │   └─ Template 4: "Ding dong~! Arona nhắc..."
           │   (Randomly selected)
           │
           └─ Record sent reminder
              │
              └─→ HealthReminderEvent
                 │
                 ├─ windowKey: "health-water"
                 ├─ notificationText: (generated or fallback)
                 └─ title: "💧 Nhắc uống nước"
                    │
                    ↓
           ┌────────────────────────────────┐
           │  Enqueue to All Platforms      │
           ├────────────────────────────────┤
           │                                │
           ├─→ iOS App (via pending queue) │
           │   └─→ BGAppRefresh / long-poll
           │       └─→ Local notification
           │       └─→ Watch mirror
           │
           ├─→ Telegram
           │   └─→ Chat message to channel
           │
           ├─→ Discord
           │   └─→ DM or channel post
           │
           └─→ Watch (direct)
               └─→ WatchMessagingService
```

---

## Step Count in Movement Reminder

```
Movement Reminder Fire
│
├─ Get latest steps from health-config.ts
│  │
│  └─ latestSteps = 5234 (or null if never synced)
│
├─ Build LLM Prompt
│  │
│  └─ Template: "Arona nhắc Sensei đứng dậy vận động..."
│     + Dynamic: "Hôm nay Sensei đã đi được 5234 bước."
│     + Instruction: "Nếu số bước > 2000 thì khen, chưa đủ thì nhắc"
│
├─ Call LLM
│  │
│  └─ Response: "Wow! 5234 bước hôm nay rồi!
│                Sensei thực sự tuyệt vời! 💪
│                Hãy tiếp tục giữ đà nha!"
│
└─ Send notification with generated text
```

### Current Problem

- latestSteps is NULL because iOS never sends data
- LLM prompt has: "Hôm nay Sensei đã đi được null bước"
- Fallback template doesn't mention step count

---

## Recommended: New Health Sync Service (iOS)

```
┌────────────────────────────────────────────────────────────────┐
│           HealthSyncService (TO IMPLEMENT)                     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Properties                                               │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │ - lastSyncTime: TimeInterval?                            │ │
│  │ - cachedSteps: Int?                                      │ │
│  │ - syncFrequency: TimeInterval (default: 1 day)           │ │
│  │ - motionService: MotionServicing                         │ │
│  │ - gateway: GatewayNodeSession                            │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Methods                                                  │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │ func requestMotionPermission() async -> Bool             │ │
│  │ func hasMotionPermission() -> Bool                       │ │
│  │ func syncStepsIfNeeded() async                           │ │
│  │ func syncStepsNow() async throws                         │ │
│  │ func getTodaySteps() async -> Int?                       │ │
│  │ func shouldSync() -> Bool                                │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Sync Flow                                                │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │                                                          │ │
│  │  1. Check permission granted                            │ │
│  │  2. Query CoreMotion pedometer (today)                  │ │
│  │  3. POST to /arona/push/health { steps: X }            │ │
│  │  4. On success: cache steps + timestamp                │ │
│  │  5. On error: retry with exponential backoff           │ │
│  │                                                          │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Integration Points                                       │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │                                                          │ │
│  │ - NodeAppModel.init(): Start sync service              │ │
│  │ - Background refresh: Call syncStepsIfNeeded()         │ │
│  │ - Movement reminder fire: Prompt sync                  │ │
│  │ - Settings UI: Display cached steps + [Sync Now]      │ │
│  │ - Watch: Mirror step count to complication            │ │
│  │                                                          │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Future: HealthKit Integration

```
┌────────────────────────────────────────────────────────────────┐
│              HealthKit Service (FUTURE)                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Reading (with HKHealthStore)                                 │
│  ├─ Steps (HKQuantityTypeIdentifier.stepCount)               │ │
│  ├─ Heart Rate (HKQuantityTypeIdentifier.heartRate)          │ │
│  ├─ Sleep (HKCategoryTypeIdentifier.sleepAnalysis)           │ │
│  ├─ Workouts (HKWorkout)                                      │
│  └─ All synced daily to backend health-config.ts            │ │
│                                                                │
│  Writing (for closed-loop fitness)                            │
│  ├─ Create Workout (after AI suggests exercise)             │ │
│  ├─ Log workout completion back to HealthKit               │ │
│  └─ Federate with Apple Health ecosystem                    │ │
│                                                                │
│  Backend Integration                                          │
│  ├─ health-config.ts: extends with HK data                 │ │
│  ├─ health-scheduler: includes HK metrics in prompts       │ │
│  │   "Sensei's resting heart rate is elevated..."         │ │
│  │   "Sensei slept 6.5 hours last night..."               │ │
│  ├─ health-config-tool: view HK summary                   │ │
│  └─ Can trigger reminders based on HK thresholds:        │ │
│      "If heart rate > 100, suggest cool down"             │ │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

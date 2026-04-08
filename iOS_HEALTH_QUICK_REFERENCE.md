# iOS Health Features - Quick Reference

## 📋 Current Status at a Glance

| Feature                   | Status | Details                                    |
| ------------------------- | ------ | ------------------------------------------ |
| **Motion Queries**        | ✅     | CoreMotion pedometer/activity queries work |
| **Health Reminders**      | ✅     | Backend scheduler + LLM generation working |
| **Step Sync to Backend**  | ❌     | Endpoint exists, but iOS never calls it    |
| **Health Settings UI**    | ❌     | Missing section in Settings tab            |
| **HealthKit Integration** | ❌     | No HealthKit framework usage               |
| **Background Sync**       | ❌     | No background task for health data         |
| **Watch Integration**     | 🟡     | Notifications work, but no complications   |

---

## 🔧 Key Files (Location Reference)

### iOS App

```
apps/ios/Sources/
├── Motion/
│   └── MotionService.swift                 ✅ Pedometer & activity queries
├── Model/
│   └── NodeAppModel.swift                  ✅ Motion routing (handleMotionInvoke)
├── Settings/
│   └── SettingsTab.swift                   ❌ Missing Health section
├── Services/
│   └── NotificationService.swift           ✅ Push notification setup
└── Info.plist                              ❌ Missing motion/health permissions
```

### Shared Protocols

```
apps/shared/ShittimChestKit/Sources/ShittimChestKit/
└── MotionCommands.swift                    ✅ Command & payload types
```

### Backend

```
src/arona/health/
├── health-config.ts                        ✅ Config persistence + step tracking
└── health-scheduler.ts                     ✅ LLM reminder generation

src/arona/push/
└── push-handler.ts                         ✅ /arona/push/health endpoint (lines 292-313)

src/agents/tools/
└── health-config-tool.ts                   ✅ Chat interface for reminders

src/gateway/server-methods/
└── health-reminders.ts                     ✅ Gateway RPC endpoints
```

---

## 📡 API Endpoints

### iOS → Backend

#### Motion Query (Gateway RPC)

```
Method: nodes.invoke
Command: motion.pedometer | motion.activity
Response: JSON with steps, distance, floors, confidence
Auth: Gateway token
```

#### Health Data Submission (Push Handler)

```
POST /arona/push/health
Authorization: Bearer <gateway-token>
Content-Type: application/json

{
  "steps": 8234
}

Response: { "ok": true }
```

**Status**: Endpoint implemented, but iOS never POSTs

---

## 🏥 Health Reminder Types

### Default Configuration

| Reminder     | Interval | Active Hours | LLM Prompt                       | Fallbacks  |
| ------------ | -------- | ------------ | -------------------------------- | ---------- |
| **Water**    | 120 min  | 7-22         | "Uống nước" (hydration)          | 4 variants |
| **Eyes**     | 45 min   | 7-23         | "Nghỉ mắt" (20-20-20 rule)       | 4 variants |
| **Movement** | 180 min  | 7-22         | "Vận động" (includes step count) | 4 variants |
| **Sleep**    | 1440 min | 22-23        | "Đi ngủ" (bedtime)               | 1 variant  |

### Customization

✅ Via Chat:

```
"Nhắc uống nước mỗi 1.5 tiếng"
"Turn off eye break reminders"
"Change movement reminder to 2 hours"
```

❌ Via Settings UI: Not implemented

---

## 🔐 Permissions Required

### Already Requested

- ✅ Camera
- ✅ Local Network
- ✅ Location (When In Use / Always)
- ✅ Microphone
- ✅ Speech Recognition

### Missing

- ❌ Motion (`NSMotionUsageDescription`)
- ❌ HealthKit Read (`NSHealthShareUsageDescription`)
- ❌ HealthKit Write (`NSHealthUpdateUsageDescription`)

### Entitlements File

- ✅ APNs: `aps-environment: development`
- ❌ HealthKit: Not configured

---

## 📊 Data Flow Summary

### Current (Broken) Flow

```
Motion Hardware
    ↓
CoreMotion → MotionService
    ↓
NodeAppModel.handleMotionInvoke()
    ↓
Gateway Protocol → Backend
    ↓
(Can be queried on-demand)
    ❌ Step data NEVER synced to /arona/push/health
    ❌ health-config.latestSteps remains NULL
    ❌ Movement reminders miss step context
```

### Desired Flow

```
Motion Hardware
    ↓
CoreMotion → MotionService
    ↓
HealthSyncService (NEW)
    ├─ Query today's steps
    ├─ Check if sync needed
    ├─ POST to /arona/push/health
    └─ Cache + display in UI
         ↓
    /arona/push/health endpoint
         ↓
    health-config.updateSteps()
         ↓
    Stored in memory for scheduler
         ↓
    Movement reminder (next fire)
         ├─ Query: latestSteps
         ├─ Inject: "Hôm nay Sensei đã đi được X bước"
         └─ LLM generates personalized response
```

---

## 🎯 Implementation Checklist

### Phase 1: Enable Motion Permission (30 min)

- [ ] Add to Info.plist: `NSMotionUsageDescription`
- [ ] Test: Build app, request permission, verify access

### Phase 2: Implement Health Sync Service (2 hours)

- [ ] Create `HealthSyncService.swift`
- [ ] Implement permission request
- [ ] Query today's steps
- [ ] POST to `/arona/push/health`
- [ ] Handle errors + retries
- [ ] Cache results locally
- [ ] Add background sync trigger

### Phase 3: Settings UI (3 hours)

- [ ] Add "Health" section to Settings
- [ ] Display permission status
- [ ] Show cached step count
- [ ] Add [Sync Now] button
- [ ] Toggle reminders (call backend)
- [ ] Slider for intervals
- [ ] Time selector for active hours

### Phase 4: HealthKit Integration (1-2 weeks)

- [ ] Add HealthKit entitlements
- [ ] Create `HealthKitService.swift`
- [ ] Read: Steps, Heart Rate, Sleep, Workouts
- [ ] Write: Workout logging
- [ ] Sync daily to backend
- [ ] Display in settings + movement reminders
- [ ] Watch complications

---

## 💡 Quick Implementation Tips

### Motion Permission

```swift
import CoreMotion

let status = CMPedometer.authorizationStatus()
// .authorized, .denied, .notDetermined

if status == .notDetermined {
    // iOS will prompt on first query attempt
}
```

### Query Today's Steps

```swift
let pedometer = CMPedometer()
let start = Calendar.current.startOfDay(for: Date())
let end = Date()

pedometer.queryPedometerData(from: start, to: end) { data, error in
    let steps = data?.numberOfSteps.intValue ?? 0
    // Use steps...
}
```

### POST to Backend

```swift
let json = """
{"steps": \(steps)}
"""

var request = URLRequest(url: url)
request.httpMethod = "POST"
request.setValue("Bearer \(gatewayToken)", forHTTPHeaderField: "Authorization")
request.httpBody = json.data(using: .utf8)

let (data, response) = try await URLSession.shared.data(for: request)
```

### Sync on Background

```swift
// In NodeAppModel.handleBackgroundRefreshWake()
await healthSyncService.syncStepsIfNeeded()
```

### Update UI

```swift
@State var stepsToday: Int?
@State var lastSyncTime: Date?

VStack {
    if let steps = stepsToday {
        Text("Steps Today: \(steps)")
    }
    if let syncTime = lastSyncTime {
        Text("Last synced: \(syncTime.formatted())")
    }
    Button("Sync Now") {
        Task { await healthSyncService.syncStepsNow() }
    }
}
```

---

## 🐛 Known Issues

| Issue               | Root Cause                               | Impact                                | Fix Effort       |
| ------------------- | ---------------------------------------- | ------------------------------------- | ---------------- |
| Steps never synced  | iOS doesn't POST to `/arona/push/health` | Reminders can't mention step count    | Low (2 hours)    |
| No health UI        | Settings view never extended             | User can't see/manage health features | Medium (3 hours) |
| No background sync  | No periodic health task                  | Data stale, inconsistent              | Low (1 hour)     |
| No HealthKit        | Never integrated                         | Missing heart rate, sleep, etc.       | High (1-2 weeks) |
| Permissions missing | Info.plist never updated                 | Can't request motion/health access    | Trivial (5 min)  |

---

## 📈 Expected Outcome

### After Phase 1-3 (1 day effort):

✅ Health reminders can reference accurate step count
✅ User can toggle reminders + adjust intervals in Settings
✅ Background sync keeps step count updated daily
✅ Watch receives reminders with step context

### After Phase 4 (1-2 week effort):

✅ HealthKit data (heart rate, sleep) in reminders
✅ Advanced health analytics
✅ Workout logging back to Apple Health
✅ Watch complications showing health metrics
✅ LLM context: "Your resting HR is elevated..."

---

## 🔗 Related Documentation

- Backend health config: `src/arona/health/health-config.ts` (77 lines)
- Backend health scheduler: `src/arona/health/health-scheduler.ts` (341 lines)
- iOS motion service: `apps/ios/Sources/Motion/MotionService.swift` (100 lines)
- Gateway health endpoints: `src/gateway/server-methods/health-reminders.ts` (51 lines)
- Chat health tool: `src/agents/tools/health-config-tool.ts` (207 lines)
- Push handler: `src/arona/push/push-handler.ts` (340 lines)

---

## 📞 Contact / Questions

All health code is well-documented with:

- TypeScript: JSDoc comments
- Swift: Inline documentation
- Test coverage (partial)

The architecture is clean and extensible. Add HealthKit by extending health-config.ts and creating a new HealthKitService.swift.

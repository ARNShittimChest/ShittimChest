# Comprehensive Analysis of HealthKit & Health Features in Arona-CLW iOS App

## EXECUTIVE SUMMARY

The iOS app **does NOT currently use Apple HealthKit** despite being a health-aware application. Instead:

1. **Motion/Pedometer Data**: Uses CoreMotion framework directly to query step count and motion activity
2. **Health Reminders**: Backend-driven interval-based reminders (water, eye breaks, movement, sleep)
3. **Step Data Sync**: Manual push from iOS app → Backend via `/arona/push/health` endpoint
4. **HealthKit Integration**: **MISSING** - no HealthKit read/write capability exists

---

## CURRENT MOTION/FITNESS IMPLEMENTATION

### iOS App - Motion Service

**File**: `apps/ios/Sources/Motion/MotionService.swift`

The app queries fitness data directly from CoreMotion:

- **Pedometer**: Step count, distance, floors ascended/descended
- **Motion Activity**: Walking, running, cycling, automotive, stationary status with confidence levels

Capabilities:

- Queries for date ranges via ISO8601 timestamps
- Returns confidence levels (low/medium/high)
- Requires Motion & Fitness permission from user
- No persistence - data is fetched on-demand from device

```swift
// Example: Pedometer Query
func pedometer(params: ShittimChestPedometerParams) async throws -> ShittimChestPedometerPayload {
    let pedometer = CMPedometer()
    pedometer.queryPedometerData(from: start, to: end) { data, error in
        // Returns: steps, distanceMeters, floorsAscended, floorsDescended
    }
}
```

### Protocol Definition

**File**: `apps/shared/ShittimChestKit/Sources/ShittimChestKit/MotionCommands.swift`

Two commands exposed to backend:

1. `motion.activity` - Query motion activities with confidence
2. `motion.pedometer` - Query step/distance/floor data

Both require user permission and return ISO8601-formatted data.

### Backend Exposure

**File**: `src/gateway/server-methods/health-reminders.ts`

Two gateway endpoints:

- `health.config.get` - Returns current health reminder config + `latestSteps` from memory
- `health.config.update` - Updates reminder settings

Both endpoints include `steps` field in response when available.

---

## HEALTH REMINDERS SYSTEM

### Backend Architecture

**Files**:

- `src/arona/health/health-config.ts` - Config storage & step tracking
- `src/arona/health/health-scheduler.ts` - Scheduler & LLM-generated notifications
- `src/agents/tools/health-config-tool.ts` - User-facing chat tool

### Reminder Types

Four configurable reminders with defaults:

| Type         | Default Interval | Active Hours | Description         |
| ------------ | ---------------- | ------------ | ------------------- |
| **Water**    | 120 min          | 7:00-22:00   | Hydration reminder  |
| **Eyes**     | 45 min           | 7:00-23:00   | 20-20-20 rule break |
| **Movement** | 180 min          | 7:00-22:00   | Stand up & stretch  |
| **Sleep**    | 1440 min (daily) | 22:00-23:00  | Bedtime reminder    |

### Features

✅ LLM-generated Arona-voice notifications (Vietnamese)
✅ Fallback pre-written templates if LLM fails
✅ Configurable intervals (5 min - 7 days)
✅ Configurable active hours (0-23)
✅ Optional IP ping before firing (for device presence)
✅ Re-reads config on every fire (live updates)
✅ Injects step count into movement reminder prompt

### Storage

Persistent config file: `.arona/health-config.json`

- Atomic write (tmp file + rename)
- Merges with defaults for schema evolution
- User-adjustable via `health_config` chat tool

### Delivery Channels

Health reminders are delivered to:

1. iOS app via push notification
2. All linked chat platforms (Telegram, Discord, etc.)
3. Watch (if paired)

---

## STEP DATA FLOW

### Step Data Submission (iOS → Backend)

**Endpoint**: `POST /arona/push/health`
**File**: `src/arona/push/push-handler.ts` (lines 292-313)
**Authentication**: Gateway token (header-based)

```
POST /arona/push/health
Authorization: Bearer <gateway-token>
Content-Type: application/json

{ "steps": 8234 }
```

Response:

```json
{ "ok": true }
```

### Step Data Integration

**File**: `src/arona/push/push-handler.ts` (line 307)

When iOS app POSTs step data:

```typescript
if (typeof body.steps === "number") {
  updateSteps(body.steps); // Stores in memory + used by health scheduler
  sendJson(res, 200, { ok: true });
}
```

### Current Problem

**❌ NO CODE IN iOS APP CALLS THIS ENDPOINT**

The iOS app:

- ✅ Has motion/pedometer capability
- ✅ Can query today's steps
- ❌ Never sends steps to `/arona/push/health`
- ❌ No background task to periodically sync steps
- ❌ No user notification when step count updates

---

## iOS SETTINGS UI

**File**: `apps/ios/Sources/Settings/SettingsTab.swift`

### Current Settings Structure

**Device Section → Features**:

```
- Voice Wake (toggle + wake words)
- Talk Mode (toggle + voice settings)
- Background Listening (toggle)
- Allow Camera (toggle)
- Location Access (Off / While Using / Always)
- Prevent Sleep (toggle)
- Talk Button (toggle)
- Default Share Instruction (text field)
```

### ❌ MISSING: Health Settings UI

No section for:

- [ ] Motion permission status
- [ ] Step counting toggle
- [ ] Health reminder configuration
- [ ] Reminder intervals (hours)
- [ ] Active hours
- [ ] Recent step count display
- [ ] Health data sync status

---

## PERMISSIONS & ENTITLEMENTS

**File**: `apps/ios/Sources/Info.plist`

Current permissions requested:

```
NSCameraUsageDescription
NSLocalNetworkUsageDescription
NSLocationAlwaysAndWhenInUseUsageDescription
NSLocationWhenInUseUsageDescription
NSMicrophoneUsageDescription
NSSpeechRecognitionUsageDescription
```

**❌ MISSING**:

```
NSMotionUsageDescription      (for step counting)
NSHealthShareUsageDescription (for HealthKit read)
NSHealthUpdateUsageDescription (for HealthKit write)
```

**Entitlements File**: `apps/ios/Sources/ShittimChest.entitlements`

- Only has `aps-environment: development` (APNs)
- No HealthKit entitlements

---

## ACCURACY & DATA FRESHNESS

### Motion Data Accuracy

✅ **HIGH**: Uses native CMPedometer (motion coprocessor on modern iPhones)

- iPhone measures steps via integrated motion hardware
- Very accurate for walking/running
- Less accurate for cycling, stationary movement

### Step Count in Reminders

**Mechanism**:

1. iOS app queries step count when needed
2. Sends to `/arona/push/health` (currently: never)
3. Backend stores `latestSteps` in memory
4. Health scheduler injects into movement reminder LLM prompt

**Current Freshness**:
❌ Never updated because iOS doesn't send the data

**Desired Freshness**:

- Should sync daily
- Or sync when movement reminder fires
- Or sync on demand (background task)

---

## SYNC MECHANISM (iOS ↔ Backend)

### How iOS App Communicates Health

**Via Gateway Protocol** (local network):

1. Capability routing through `NodeCapabilityRouter`
2. Motion commands: `motion.pedometer`, `motion.activity`
3. Responses JSON-encoded in gateway protocol

### Data Pipeline

```
iOS Motion Service (CoreMotion)
    ↓
NodeAppModel.handleMotionInvoke()
    ↓
Gateway Protocol (JSON response)
    ↓
Backend receives via `nodes.invoke()` RPC
    ↓
Can inject into LLM context
```

### Push Notification Channel

```
Backend Health Scheduler (every N minutes)
    ↓
Generates Arona-voice notification (LLM)
    ↓
Enqueues via pending-store.ts
    ↓
iOS App BGAppRefresh / long-poll
    ↓
Displays local notification + watch mirror
```

---

## WHAT'S MISSING (OPPORTUNITIES FOR IMPROVEMENT)

### 1. **HealthKit Integration** 🔴 NOT STARTED

- [ ] Add `NSHealth*` entitlements
- [ ] Request HealthKit authorization
- [ ] Read: Steps, Heart Rate, Workouts, Sleep
- [ ] Write: Workouts (closed-loop fitness tracking)
- [ ] Sync HealthKit data to backend daily
- [ ] Surface in health reminders ("Your heart rate is elevated...")

### 2. **Step Data Sync** 🔴 NOT STARTED

- [ ] Background task to sync step count daily
- [ ] Sync on-demand when movement reminder fires
- [ ] Cache step count locally with timestamp
- [ ] Display "Steps today: XXX" in UI
- [ ] Track step trends (weekly, monthly)

### 3. **Health Settings UI** 🔴 NOT STARTED

- [ ] New "Health" section in Settings
- [ ] Permission status indicator
- [ ] Reminder toggles (water, eyes, movement, sleep)
- [ ] Interval sliders (5-1440 min)
- [ ] Active hours selector
- [ ] Last sync timestamp
- [ ] Sync now button

### 4. **Reminder Customization** 🟡 PARTIAL

- [ ] Backend has config system (config tool + persistence)
- [ ] ✅ Controllable via chat: "Remind me every 2 hours"
- [ ] ❌ No iOS UI to change settings
- [ ] ❌ Can't toggle reminders from phone

### 5. **Watch Integration** 🟡 PARTIAL

- [ ] Watch notifications working (WatchMessagingService)
- [ ] ❌ No watch complications
- [ ] ❌ No watch app for step sync
- [ ] ❌ No watch settings UI

### 6. **Accuracy Improvements** 🟢 GOOD START

- [x] Uses accurate CoreMotion pedometer
- [ ] Could add GPS-based movement detection
- [ ] Could validate steps against motion activity
- [ ] Could add heart rate if HealthKit available
- [ ] Could add sleep tracking from HealthKit

### 7. **Push Notification Delivery** 🟢 GOOD

- [x] Local network long-poll
- [x] BGAppRefresh fallback
- [x] Watch mirror notifications
- [ ] Could add sound/haptic customization
- [ ] Could track acknowledgment (Sensei read reminder?)

---

## CODE LOCATIONS SUMMARY

| Component              | File                                                           | Status                   |
| ---------------------- | -------------------------------------------------------------- | ------------------------ |
| Motion Service (iOS)   | `apps/ios/Sources/Motion/MotionService.swift`                  | ✅                       |
| Motion Protocol        | `apps/shared/ShittimChestKit/Sources/.../MotionCommands.swift` | ✅                       |
| Health Config          | `src/arona/health/health-config.ts`                            | ✅                       |
| Health Scheduler       | `src/arona/health/health-scheduler.ts`                         | ✅                       |
| Health Tool            | `src/agents/tools/health-config-tool.ts`                       | ✅                       |
| Push Handler           | `src/arona/push/push-handler.ts`                               | ✅                       |
| iOS Settings UI        | `apps/ios/Sources/Settings/SettingsTab.swift`                  | ❌ No health section     |
| Info.plist Permissions | `apps/ios/Sources/Info.plist`                                  | ❌ Missing motion/health |
| Step Sync Code         | (iOS)                                                          | ❌ NOT IMPLEMENTED       |
| Health Settings UI     | (iOS)                                                          | ❌ NOT IMPLEMENTED       |

---

## RECOMMENDATIONS

### Quick Wins (1-2 days each)

1. Add permissions to Info.plist + entitlements
2. Implement daily step sync to `/arona/push/health`
3. Add simple "Health Status" UI in Settings (read-only)

### Medium Effort (3-5 days each)

4. Build Health Settings UI section
5. Sync on every background refresh
6. Display step count dashboard
7. Add reminder toggles in UI

### Larger Effort (1-2 weeks)

8. Full HealthKit integration (read)
9. Workout data sync
10. Sleep tracking
11. Watch complications
12. Advanced analytics

---

## CONCLUSION

The Arona-CLW health system is well-architected on the **backend side**:

- ✅ Configurable reminders with LLM generation
- ✅ User-adjustable via chat
- ✅ Good notification delivery pipeline
- ✅ Step count awareness in reminders

But the **iOS side is incomplete**:

- ✅ Can query steps via CoreMotion
- ❌ Doesn't send step data to backend
- ❌ No UI for health settings
- ❌ No HealthKit integration
- ❌ No background sync

**The step data exists on the phone but never reaches the backend.**

This is a high-impact area for improvement that would significantly enhance health tracking and personalization.

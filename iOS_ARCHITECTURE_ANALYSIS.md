# ShittimChest iOS App - Complete Architecture Analysis

**Project Path:** `/Volumes/OCungRoi/PRJ/Arona-CLW/apps/ios`
**App Name:** ShittimChest (internal codename, formal name TBD)
**iOS Target Version:** 18.0+
**Swift Version:** 6.0 with strict concurrency
**Status:** Super-Alpha (internal use only)

---

## 1. APP STRUCTURE & LAYOUT

### Directory Organization

```
apps/ios/Sources/
├── ShittimChestApp.swift          # Main @main app entry point
├── RootView.swift                 # Root view wrapper
├── RootCanvas.swift               # Main canvas/screen view with overlay buttons
├── RootTabs.swift                 # TabView-based navigation (fallback structure)
├── SessionKey.swift               # Session key management
├── Info.plist                      # App metadata & permissions
├── ShittimChest.entitlements      # APNs + capabilities
│
├── Screen/                         # Canvas/display rendering
│   ├── ScreenTab.swift             # WebView container for remote UI
│   ├── ScreenWebView.swift         # WKWebView wrapper
│   ├── ScreenController.swift      # State management
│   └── ScreenRecordService.swift   # Screen recording capability
│
├── Voice/                          # Voice Wake & Talk Mode
│   ├── VoiceTab.swift              # Voice status view
│   ├── VoiceWakeManager.swift      # Wake word detection
│   ├── VoiceWakePreferences.swift  # User settings storage
│   ├── TalkModeManager.swift       # Two-way conversation manager
│   └── TalkOrbOverlay.swift        # Animated orb UI overlay
│
├── Settings/                       # Configuration & Settings UI
│   ├── SettingsTab.swift           # Main settings screen (49KB)
│   ├── SettingsNetworkingHelpers.swift
│   └── VoiceWakeWordsSettingsView.swift
│
├── Gateway/                        # Connection & Discovery
│   ├── GatewayConnectionController.swift  # Main connection state machine
│   ├── GatewayDiscoveryModel.swift        # Bonjour/mDNS discovery
│   ├── GatewaySettingsStore.swift         # Persistent storage
│   ├── GatewayHealthMonitor.swift         # Connection health checks
│   ├── GatewayConnectConfig.swift         # Connection parameters
│   ├── TCPProbe.swift                     # Network connectivity
│   ├── KeychainStore.swift                # Secure token storage
│   └── [UI Views]                         # Alerts, setup sheets
│
├── Model/                          # Core App State
│   ├── NodeAppModel.swift          # @Observable main app state (2500+ lines)
│   ├── NodeAppModel+Canvas.swift   # Canvas-specific methods
│   ├── NodeAppModel+WatchNotifyNormalization.swift
│   └── [Extensions]
│
├── Services/                       # iOS Device Integrations
│   ├── NodeServiceProtocols.swift  # Service interfaces
│   ├── NotificationService.swift   # APNs handling
│   ├── WatchMessagingService.swift # Watch connectivity
│
├── [Capability Modules]            # iOS Device Features
│   ├── Camera/                     # Photo/video capture
│   ├── Location/                   # GPS & location services
│   ├── Contacts/                   # Contacts database
│   ├── Calendar/                   # Calendar events
│   ├── Reminders/                  # Reminders integration
│   ├── Motion/                     # Pedometer & activity
│   ├── Media/                      # Photos library
│   ├── EventKit/                   # Calendar authorization
│   ├── Device/                     # Device info & status
│   └── Chat/                       # Chat UI integration
│
├── Status/                         # Status Indicators
│   ├── StatusPill.swift            # Connection status pill (top-left)
│   ├── StatusActivityBuilder.swift # Activity state builder
│   └── VoiceWakeToast.swift        # Toast notification overlay
│
├── Onboarding/                     # First-time Setup
│   ├── OnboardingWizardView.swift  # Main wizard flow
│   ├── OnboardingStateStore.swift  # Onboarding state
│   ├── GatewayOnboardingView.swift
│   └── QRScannerView.swift         # QR code scanning
│
├── Capabilities/                   # Request routing
│   └── NodeCapabilityRouter.swift  # Routes device commands to handlers
│
└── Assets.xcassets/                # App icons, images
```

### Build Configuration

- **Xcode Project Generator:** XcodeGen (from `project.yml`)
- **Code Signing:** Team-based + local overrides
- **Build Scripts:**
  - SwiftFormat (lint check)
  - SwiftLint (static analysis)
  - Pre-build validation

---

## 2. NAVIGATION STRUCTURE

### Primary Navigation Pattern: **Overlay Canvas**

**RootCanvas** is the primary view architecture:

```swift
ZStack {
    ScreenTab()  // Main WKWebView (remote UI)

    VStack {  // Overlay buttons (top-right)
        OverlayButton("Chat")       // Opens ChatSheet modal
        OverlayButton("Talk")       // Toggles TalkMode (in-place)
        OverlayButton("Settings")   // Opens SettingsTab as sheet
    }

    StatusPill()  // Top-left: connection indicator
    VoiceWakeToast()  // Top-left: voice commands feedback
    TalkOrbOverlay()  // Center: Talk mode visualizer
}
```

### Secondary Navigation: **Sheet Modals**

```swift
enum PresentedSheet: Identifiable {
    case settings      // SettingsTab (full-screen equivalent)
    case chat          // ChatSheet
    case quickSetup    // GatewayQuickSetupSheet (onboarding helper)
}
```

### Fallback Structure: **TabView** (RootTabs.swift)

- **Tab 0:** Screen (WKWebView)
- **Tab 1:** Voice (status + wake words)
- **Tab 2:** Settings (gateway, features, debug)

**Current Primary:** Overlay canvas (RootCanvas) is what's actively used.

### Navigation Patterns

- **No NavigationStack in main view** (agent-driven navigation via canvas)
- **Local NavigationStack in Settings** for sub-pages
- **Modal sheets for temporary flows** (settings, chat, onboarding)
- **Full-screen covers for onboarding** (OnboardingWizardView)

---

## 3. SETTINGS & CONFIGURATION

### Settings Storage

**Backend:** `@AppStorage` (UserDefaults) + Keychain for sensitive data

#### Core Settings Keys

```swift
// Gateway
@AppStorage("gateway.preferredStableID")         // Last connected gateway UUID
@AppStorage("gateway.autoconnect")               // Auto-reconnect on launch
@AppStorage("gateway.manual.enabled")            // Use manual host/port
@AppStorage("gateway.manual.host")               // IP/hostname
@AppStorage("gateway.manual.port")               // TCP port
@AppStorage("gateway.manual.tls")                // Require TLS
@AppStorage("gateway.setupCode")                 // Pairing code (temp)

// Device/Node
@AppStorage("node.displayName")                  // Display name in gateway
@AppStorage("node.instanceId")                   // Unique device ID
@AppStorage("screen.preventSleep")               // Disable idle sleep during foreground

// Voice Wake
@AppStorage("voiceWake.enabled")                 // Master enable/disable
@AppStorage("talk.enabled")                      // Talk mode enable
@AppStorage("talk.button.enabled")               // Show talk button in UI
@AppStorage("talk.background.enabled")           // Allow background listening

// Camera & Location
@AppStorage("camera.enabled")                    // Allow camera access
@AppStorage("location.enabledMode")              // off | while_using | always

// Feature Flags
@AppStorage("canvas.debugStatusEnabled")         // Show debug overlay
@AppStorage("gateway.discovery.debugLogs")       // Enable discovery logging
@AppStorage("onboarding.requestID")              // Trigger onboarding re-run
```

#### Secure Storage (Keychain)

```swift
// In GatewaySettingsStore:
GatewaySettingsStore.loadGatewayToken(instanceId:)
GatewaySettingsStore.loadGatewayPassword(instanceId:)
GatewaySettingsStore.loadLastGatewayConnection()
GatewayTLSStore.loadFingerprint(stableID:)
```

### Settings UI (SettingsTab.swift - 49KB)

**Main Sections:**

1. **Gateway Setup** (DisclosureGroup)
   - Setup code input + Connect button
   - Gateway discovery list
   - Manual host/port/TLS config
   - Gateway status & disconnect
   - Advanced options

2. **Device Features** (Section)
   - Voice Wake: toggle + wake word picker
   - Talk Mode: toggle + background listening
   - Camera: enable/disable access
   - Location: off / while-using / always picker
   - Sleep prevention toggle

3. **Debug Tools** (Hidden by default)
   - Canvas debug status toggle
   - Discovery debug logs
   - Auth token/password fields
   - Reset onboarding button
   - Debug text display

---

## 4. API & NETWORKING ARCHITECTURE

### Primary Protocol: **WebSocket (GatewayChannel)**

**Location:** Defined in `ShittimChestKit` (shared framework)

**Session Types:**

```swift
// Two independent WebSocket connections maintained:
private let nodeGateway = GatewayNodeSession()          // Device capabilities
private let operatorGateway = GatewayNodeSession()      // Chat, Talk, Config
```

### Connection Flow

```
1. Discovery (Bonjour/mDNS) → List available gateways
2. TLS Fingerprint Verification → Manual trust on first connection
3. WebSocket Connect → TLS + authentication headers
4. Session Registration → Register APNs token, device ID
5. Maintain Dual Sessions → Node + Operator channels
```

### RPC Methods (node.invoke)

**Typical pattern:**

```swift
// Send method call
try await channel.send(method: "node.invoke", params: {
    id: UUID(),
    instruction: "camera.snap(...)",
    params: {...}
})

// Receive response via callback
func handleInvokeResponse(payload: NodeInvokeResponsePayload) async {
    // Process result
}
```

### Event Streaming (node.event)

**For voice transcripts, location updates, etc:**

```swift
await self.sendEvent(event: "voiceTranscript", payloadJSON: "...")
```

### Push Notifications (APNs)

**Integration Points:**

```swift
// In AppDelegate:
func application(didRegisterForRemoteNotificationsWithDeviceToken:)
    → appModel.updateAPNsDeviceToken(token)

// On APNs arrival:
func application(didReceiveRemoteNotification:fetchCompletionHandler:)
    → appModel.handleSilentPushWake(userInfo)

// User taps notification:
func userNotificationCenter(didReceive response:)
    → appModel.handleMirroredWatchPromptAction(...)
```

**Push Types:**

- Silent push (background wake)
- User notifications (watch prompt mirroring)
- Background app refresh (BGTaskScheduler)

### Connection Health Monitoring

**GatewayHealthMonitor:**

- Periodic liveness pings
- Auto-reconnect on disconnect
- Exponential backoff for failed reconnects
- Detects and recovers from dead sockets

---

## 5. COLOR SCHEME & DESIGN SYSTEM

### Color Palette

**Hardcoded Colors:**

- **Primary Accent:** `seamColor` (dynamic per agent/session)
  - Stored in `appModel.seamColorHex`
  - Applied to: Talk orb, accent buttons, highlights
  - Extracted from gateway configuration

- **Status Indicators:**
  - Connected: `.green`
  - Connecting: `.yellow` (with pulsing animation)
  - Error: `.red`
  - Disconnected: `.gray`

- **Material Style:**
  - `.ultraThinMaterial` (glass morphism)
  - `.thinMaterial` (for cards/backgrounds)
  - `.clear` overlays for glassmorphic effects

- **Text Colors:**
  - Primary: `.primary` (system default)
  - Secondary: `.secondary`
  - Accent: `seamColor` (agent-specific)

### Typography

**Font Sizes & Weights:**

```swift
// Titles
.title               // Large headings
.headline            // Section titles
.subheadline         // Secondary headings
.body                // Standard text
.footnote            // Small helper text
.caption             // Tiny labels

// Weights commonly used:
.semibold            // Headers, interactive elements
.regular             // Body text
.medium              // Emphasis

// Special styles:
.system(.caption, design: .rounded)  // Talk orb labels
.monospaced          // Debug output
```

### Design Tokens

**Spacing:**

- Padding: 10px, 12px, 14px, 28px (varies by component)
- Margins: Standard SwiftUI defaults

**Corners:**

- `.continuous` (smooth, modern style)
- Border radius: 10-14px typical

**Shadows:**

- `.shadow(color: .black.opacity(0.25), radius: 12, y: 6)` (standard depth)
- `.shadow(color: .black.opacity(0.50), radius: 22, y: 10)` (Talk orb emphasis)

**Opacity & Blends:**

- `.opacity(0.18)` → light foreground overlay
- `.opacity(0.35)` → medium foreground overlay
- `.blendMode(.overlay)` → glassmorphic lighting effect

### Animation Patterns

**Spring animations:**

```swift
.spring(response: 0.25, dampingFraction: 0.85)  // Snappy UI response
.easeOut(duration: 0.25)                         // Smooth dismissal
.easeInOut(duration: 0.9)                        // Pulsing effect
```

**Repeating animations:**

```swift
.easeInOut(duration: 0.9).repeatForever(autoreverses: true)  // Pulse
.easeOut(duration: 1.3).repeatForever(autoreverses: false)   // Ripple
```

---

## 6. PUSH NOTIFICATION HANDLING

### Notification Lifecycle

**Registration:**

```swift
// 1. At app launch:
application(didFinishLaunchingWithOptions:) {
    registerBackgroundWakeRefreshTask()
    UNUserNotificationCenter.current().delegate = self
    application.registerForRemoteNotifications()
}

// 2. APNs gives device token:
application(didRegisterForRemoteNotificationsWithDeviceToken:) {
    appModel.updateAPNsDeviceToken(token)  // Send to gateway
}
```

**Receiving (Foreground & Background):**

```swift
// Silent push (background wake):
application(didReceiveRemoteNotification:fetchCompletionHandler:) {
    let handled = await appModel.handleSilentPushWake(userInfo)
    completionHandler(handled ? .newData : .noData)
}

// User notification (watch prompt mirroring):
userNotificationCenter(willPresent:withCompletionHandler:) {
    // Decide if show banner/sound/badge
}

userNotificationCenter(didReceive:withCompletionHandler:) {
    // User tapped notification → route action
    guard let action = parseWatchPromptAction(from: response) else { return }
    await routeWatchPromptAction(action)
}
```

### Watch Prompt Notification Bridge

**Special handling for Watch notifications mirrored to iPhone:**

```swift
enum WatchPromptNotificationBridge {
    static let typeKey = "shittimchest.type"
    static let typeValue = "watch.prompt"
    static let promptIDKey = "shittimchest.watch.promptId"

    // Actions numbered 0-N
    static let actionPrimaryIdentifier = "shittimchest.watch.action.primary"
    static let actionSecondaryIdentifier = "shittimchest.watch.action.secondary"
    static let actionIdentifierPrefix = "shittimchest.watch.action."
}
```

### Background App Refresh

**BGTaskScheduler integration:**

```swift
// Schedule periodic wake-up:
let request = BGAppRefreshTaskRequest(identifier: "ai.shittimchest.ios.bgrefresh")
request.earliestBeginDate = Date().addingTimeInterval(delay)
BGTaskScheduler.shared.submit(request)

// Handle wake:
handleBackgroundWakeRefresh(task: BGAppRefreshTask) {
    await appModel.handleBackgroundRefreshWake(trigger: "bg_app_refresh")
}
```

---

## 7. EXISTING HEALTH/WELLNESS UI

**Current Status:** No dedicated health/wellness dashboard exists.

**Related Features:**

- **Device Status:** `DeviceStatusService` can query battery, network
- **Location Service:** Tracks GPS for automation triggers
- **Motion Service:** Pedometer + activity classification
- **Status Pill:** Shows connection health + activity indicators

**Potential Areas for Health UI:**

- Device battery status card
- Location status indicator
- Voice wake / Talk mode statistics
- Network latency/quality metrics
- Background service status

---

## 8. DEPENDENCIES & FRAMEWORKS

### Direct Dependencies (project.yml)

**Internal Packages:**

```
ShittimChestKit (from ../shared/ShittimChestKit)
  - Provides: Core protocols, WebSocket client, device commands
  - Sub-products: ShittimChestChatUI, ShittimChestProtocol

Swabble (from ../../Swabble)
  - Provides: SwabbleKit (purpose unclear from analysis)
```

**System Frameworks:**

```swift
import AVFoundation        // Camera/audio
import Contacts           // Contacts database
import CoreLocation       // GPS
import CoreMotion         // Accelerometer, pedometer
import CryptoKit           // Cryptography
import EventKit           // Calendar authorization
import Foundation
import Network            // Network connectivity
import Observation        // @Observable macro
import Photos             // Photo library
import ReplayKit          // Screen recording
import Security           // Keychain
import Speech             // Voice recognition
import SwiftUI            // UI framework
import UIKit              // iOS-specific APIs
import UserNotifications  // Push notifications
import BackgroundTasks    // App refresh
import WatchConnectivity  // Watch messaging (WatchExtension only)
```

### Version Requirements

- **iOS:** 18.0+
- **Swift:** 6.0 (strict concurrency)
- **Xcode:** 16.0+

---

## 9. APP STATE MANAGEMENT

### Core State: NodeAppModel (@Observable, @MainActor)

**Approximately 2500+ lines, defines:**

#### Connection State

```swift
var gatewayStatusText: String
var nodeStatusText: String
var operatorStatusText: String
var gatewayServerName: String?
var gatewayRemoteAddress: String?
var connectedGatewayID: String?
var gatewayAutoReconnectEnabled: Bool
var gatewayPairingPaused: Bool
```

#### Session Information

```swift
var seamColorHex: String?
var selectedAgentId: String?
var gatewayDefaultAgentId: String?
var gatewayAgents: [AgentSummary]
var mainSessionKey: String (computed)
var chatSessionKey: String
```

#### Transient UI State

```swift
var cameraHUDText: String?
var cameraHUDKind: CameraHUDKind?
var screenRecordActive: Bool
var isBackgrounded: Bool
var lastShareEventText: String
var openChatRequestID: Int  // Trigger chat modal
```

#### Manager Instances

```swift
let screen: ScreenController
let voiceWake: VoiceWakeManager
let talkMode: TalkModeManager
// + device services: camera, location, contacts, calendar, etc.
```

### Initialization

```swift
init(
    screen: ScreenController = ScreenController(),
    camera: CameraServicing = CameraController(),
    screenRecorder: ScreenRecordingServicing = ScreenRecordService(),
    locationService: LocationServicing = LocationService(),
    // ... 7 more service parameters
    talkMode: TalkModeManager = TalkModeManager()
)
```

---

## 10. KEY ENTRY POINTS & INITIALIZATION

### App Lifecycle

**Main Entry Point (ShittimChestApp):**

```swift
@main
struct ShittimChestApp: App {
    @State private var appModel: NodeAppModel
    @State private var gatewayController: GatewayConnectionController
    @UIApplicationDelegateAdaptor(ShittimChestAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootCanvas()
                .environment(appModel)
                .onOpenURL { url in
                    Task { await appModel.handleDeepLink(url: url) }
                }
                .onChange(of: scenePhase) { _, newValue in
                    appModel.setScenePhase(newValue)
                    gatewayController.setScenePhase(newValue)
                }
        }
    }
}
```

**AppDelegate (ShittimChestAppDelegate):**

```swift
@MainActor
final class ShittimChestAppDelegate: NSObject,
    UIApplicationDelegate,
    UNUserNotificationCenterDelegate
{
    // Handles:
    // - APNs registration
    // - Silent push wake
    // - Background app refresh
    // - User notification responses
    // - Watch prompt actions
}
```

### Startup Sequence

1. Install uncaught exception handler (NSSetUncaughtExceptionHandler)
2. Bootstrap persistence (GatewaySettingsStore)
3. Initialize NodeAppModel + services
4. Initialize GatewayConnectionController (starts Bonjour discovery)
5. Register for remote notifications
6. Evaluate onboarding presentation route
7. Show canvas or onboarding fullscreen

### Onboarding Logic

```swift
static func startupPresentationRoute(
    gatewayConnected: Bool,
    hasConnectedOnce: Bool,
    onboardingComplete: Bool,
    hasExistingGatewayConfig: Bool,
    shouldPresentOnLaunch: Bool
) -> StartupPresentationRoute
```

Routes:

- `.none` → show canvas directly
- `.onboarding` → show OnboardingWizardView (full-screen)
- `.settings` → show SettingsTab as sheet (recovery path)

---

## 11. FILE SIZE ANALYSIS

### Largest Files (complexity indicators)

1. **SettingsTab.swift** — 49KB (settings UI + gateway config)
2. **RootCanvas.swift** — 22KB (main canvas layout + overlays)
3. **ShittimChestApp.swift** — 22KB (app delegate + notification bridge)
4. **GatewayConnectionController.swift** — 42KB (discovery + connection state)
5. **GatewaySettingsStore.swift** — 18KB (persistent storage)
6. **NodeAppModel.swift** — 2500+ lines (main app state)

---

## 12. TESTING & BUILD ARTIFACTS

### Testing Infrastructure

```
Tests/
├── [Test targets for iOS app]
```

**Test target:**

- `ShittimChestTests` (bundle.unit-test)
- Linked to main `ShittimChest` target
- Uses `TEST_HOST` pattern

### Build Scripts

1. **SwiftFormat (lint)** — Enforces code style
2. **SwiftLint** — Static analysis checks
3. **XcodeGen** — Generates `.xcodeproj` from `project.yml`

---

## 13. PERMISSIONS & ENTITLEMENTS

### Info.plist Declarations

```swift
NSLocalNetworkUsageDescription        // Bonjour discovery
NSBonjourServices                    // _shittimchest-gw._tcp
NSCameraUsageDescription             // Photo/video capture
NSLocationWhenInUseUsageDescription   // Foreground GPS
NSLocationAlwaysAndWhenInUseUsageDescription  // Background GPS
NSMicrophoneUsageDescription         // Voice wake
NSSpeechRecognitionUsageDescription  // Speech-to-text
NSAppTransportSecurity               // Allow arbitrary loads in web content
```

### Capabilities (ShittimChest.entitlements)

- Push Notifications (APNs)
- Background Modes:
  - `audio` — for talk mode background listening
  - `remote-notification` — for silent push wake
- Bonjour service discovery
- Local network access

### Signing Configuration

```
CODE_SIGN_IDENTITY: "Apple Development"
PROVISIONING_PROFILE_SPECIFIER: Dynamic
DEVELOPMENT_TEAM: Configurable
PRODUCT_BUNDLE_IDENTIFIER: ai.shittimchest.* (configurable)
```

---

## 14. KEY PATTERNS & BEST PRACTICES

### SwiftUI Patterns

- **@Observable** — Reactive state (no @StateObject needed)
- **@Environment** — Dependency injection
- **@AppStorage** — Lightweight persistence
- **.environment()** — Pass state down tree
- **Task { @MainActor in ... }** — Main thread operations
- **@preconcurrency** — Compatibility with non-Sendable types

### Concurrency Model

- **Strict Concurrency (Swift 6)** enabled
- **Sendable conformance** required for types crossing thread boundaries
- **@MainActor** — Enforces main thread
- **async/await** — Structured concurrency
- **CheckedContinuation** — Bridge legacy callbacks

### Error Handling

- Errors logged via `Logger` (os.log)
- Graceful fallbacks in UI
- Non-fatal errors don't crash (try? or try catch patterns)

### Networking Resilience

- **Auto-reconnect** with exponential backoff
- **Health monitoring** (GatewayHealthMonitor)
- **Dual sessions** (node + operator) for redundancy
- **Background wake** on silent push

---

## 15. KNOWN LIMITATIONS & OPEN QUESTIONS

### Current Limitations (from README)

- **Foreground-first:** Background support limited
- **Background command restrictions:** canvas, camera, screen, talk blocked when backgrounded
- **Location requires Always permission** for background tracking
- **Voice Wake + Talk contend for microphone** (one pauses the other)
- **APNs reliability** tied to local signing/provisioning

### Possible Future Enhancements for Health/Wellness UI

1. **Health dashboard card** — battery, network, connection stats
2. **Activity tracking visualization** — pedometer data, location history
3. **Device status monitor** — thermal, memory, background capability
4. **Voice wake statistics** — usage frequency, success rate
5. **Talk mode metrics** — session duration, latency

---

## 16. SUMMARY FOR UI PLANNING

### Recommended Patterns for New Health/Wellness Features

**Card-based layout (SettingsTab style):**

```swift
DisclosureGroup("Health & Wellness") {
    LabeledContent("Battery", value: "92%")
    LabeledContent("Network", value: "WiFi 5GHz")
    LabeledContent("Location", value: "Always")
    Gauge(value: systemHealth)  // If iOS 16+
}
```

**Material design consistency:**

- Use `.ultraThinMaterial` or `.thinMaterial` for backgrounds
- Maintain seamColor accent throughout
- Follow existing opacity/shadow patterns
- Use system colors (green/red/yellow) for status

**State management:**

- Extend NodeAppModel with health properties
- Use @Observable for reactive updates
- Store persistent metrics in GatewaySettingsStore
- Poll device services as needed

**Animation approach:**

- Match existing spring/easeOut patterns
- Respect accessibility reduce motion
- Use .animation modifiers for state changes
- Avoid excessive redraw (use .animation(.none) where appropriate)

---

## PROJECT CONFIGURATION FILES

**Key configuration files to understand:**

- `project.yml` — XcodeGen configuration (build targets, dependencies, signing)
- `Info.plist` — App metadata, permissions, capabilities
- `ShittimChest.entitlements` — APNs + background modes
- `.swiftlint.yml` — Linting rules
- `Signing.xcconfig` — Code signing configuration
- `SwiftSources.input.xcfilelist` — Files included in linting/formatting

---

## QUICK REFERENCE: WHERE THINGS LIVE

| Feature                | File(s)                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| **App Entry**          | ShittimChestApp.swift, RootCanvas.swift                                 |
| **Settings UI**        | Settings/SettingsTab.swift                                              |
| **Gateway Connection** | Gateway/GatewayConnectionController.swift                               |
| **State Management**   | Model/NodeAppModel.swift                                                |
| **Voice Features**     | Voice/VoiceWakeManager.swift, TalkModeManager.swift                     |
| **Notifications**      | ShittimChestApp.swift (AppDelegate), Services/NotificationService.swift |
| **Screen/Canvas**      | Screen/ScreenWebView.swift, Screen/ScreenController.swift               |
| **Device Services**    | Services/NodeServiceProtocols.swift, \*/[Camera/Location/etc]           |
| **UI Components**      | Status/StatusPill.swift, Voice/TalkOrbOverlay.swift                     |
| **Onboarding**         | Onboarding/OnboardingWizardView.swift                                   |

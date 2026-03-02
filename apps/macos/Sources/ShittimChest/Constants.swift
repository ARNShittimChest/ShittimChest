import Foundation

// Stable identifier used for both the macOS LaunchAgent label and Nix-managed defaults suite.
// nix-shittimchest writes app defaults into this suite to survive app bundle identifier churn.
let launchdLabel = "ai.shittimchest.mac"
let gatewayLaunchdLabel = "ai.shittimchest.gateway"
let onboardingVersionKey = "shittimchest.onboardingVersion"
let onboardingSeenKey = "shittimchest.onboardingSeen"
let currentOnboardingVersion = 7
let pauseDefaultsKey = "shittimchest.pauseEnabled"
let iconAnimationsEnabledKey = "shittimchest.iconAnimationsEnabled"
let swabbleEnabledKey = "shittimchest.swabbleEnabled"
let swabbleTriggersKey = "shittimchest.swabbleTriggers"
let voiceWakeTriggerChimeKey = "shittimchest.voiceWakeTriggerChime"
let voiceWakeSendChimeKey = "shittimchest.voiceWakeSendChime"
let showDockIconKey = "shittimchest.showDockIcon"
let defaultVoiceWakeTriggers = ["shittimchest"]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = "shittimchest.voiceWakeMicID"
let voiceWakeMicNameKey = "shittimchest.voiceWakeMicName"
let voiceWakeLocaleKey = "shittimchest.voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = "shittimchest.voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = "shittimchest.voicePushToTalkEnabled"
let talkEnabledKey = "shittimchest.talkEnabled"
let iconOverrideKey = "shittimchest.iconOverride"
let connectionModeKey = "shittimchest.connectionMode"
let remoteTargetKey = "shittimchest.remoteTarget"
let remoteIdentityKey = "shittimchest.remoteIdentity"
let remoteProjectRootKey = "shittimchest.remoteProjectRoot"
let remoteCliPathKey = "shittimchest.remoteCliPath"
let canvasEnabledKey = "shittimchest.canvasEnabled"
let cameraEnabledKey = "shittimchest.cameraEnabled"
let systemRunPolicyKey = "shittimchest.systemRunPolicy"
let systemRunAllowlistKey = "shittimchest.systemRunAllowlist"
let systemRunEnabledKey = "shittimchest.systemRunEnabled"
let locationModeKey = "shittimchest.locationMode"
let locationPreciseKey = "shittimchest.locationPreciseEnabled"
let peekabooBridgeEnabledKey = "shittimchest.peekabooBridgeEnabled"
let deepLinkKeyKey = "shittimchest.deepLinkKey"
let modelCatalogPathKey = "shittimchest.modelCatalogPath"
let modelCatalogReloadKey = "shittimchest.modelCatalogReload"
let cliInstallPromptedVersionKey = "shittimchest.cliInstallPromptedVersion"
let heartbeatsEnabledKey = "shittimchest.heartbeatsEnabled"
let debugPaneEnabledKey = "shittimchest.debugPaneEnabled"
let debugFileLogEnabledKey = "shittimchest.debug.fileLogEnabled"
let appLogLevelKey = "shittimchest.debug.appLogLevel"
let voiceWakeSupported: Bool = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26

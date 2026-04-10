import Foundation

// MARK: - Mood Enum (13 moods matching TypeScript emotional-state.ts)

/// Arona's mood states — mirrors the `Mood` union type in `src/companion/emotional-state.ts`.
public enum ShittimChestCompanionMood: String, Codable, Sendable, CaseIterable, Equatable {
    case happy
    case neutral
    case sad
    case excited
    case worried
    case caring
    case sleepy
    case bored
    case focused
    case curious
    case playful
    case grateful
    case nostalgic
}

// MARK: - Affection Level (1-5)

/// Affection level derived from affection points.
/// Thresholds: [0, 21, 41, 61, 81] → levels 1-5.
public enum ShittimChestAffectionLevel: Int, Codable, Sendable, Comparable {
    case stranger = 1
    case acquaintance = 2
    case friend = 3
    case closeFriend = 4
    case bestFriend = 5

    public static func from(points: Double) -> ShittimChestAffectionLevel {
        let p = Int(points)
        switch p {
        case 81...: return .bestFriend
        case 61...80: return .closeFriend
        case 41...60: return .friend
        case 21...40: return .acquaintance
        default: return .stranger
        }
    }

    public static func < (lhs: ShittimChestAffectionLevel, rhs: ShittimChestAffectionLevel) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

// MARK: - Emotional State

/// Arona's emotional state — mirrors `EmotionalState` in `src/companion/emotional-state.ts`.
///
/// JSON keys are camelCase (TypeScript's `JSON.stringify` output).
public struct ShittimChestEmotionalState: Codable, Sendable, Equatable {
    /// Current mood (one of 13 moods).
    public var mood: ShittimChestCompanionMood

    /// Intensity of current mood (0.0 – 1.0).
    public var intensity: Double

    /// Timestamp (ms) of last mood change.
    public var lastChangeMs: Double

    /// Recent trigger reasons (max 5).
    public var triggers: [String]

    /// Affection score (0 – 100).
    public var affection: Double

    // ── Bidirectional: Arona's perception of Sensei ────────────

    /// How Arona reads Sensei's current mood.
    public var senseiMood: ShittimChestCompanionMood?

    /// Intensity of Arona's perception of Sensei's mood (0.0 – 1.0).
    public var senseiIntensity: Double?

    /// Short tag for why Arona feels this way about the interaction.
    public var lastReflectionReason: String?

    // ── Computed helpers ────────────────────────────────────────

    /// Derived affection level (1–5).
    public var affectionLevel: ShittimChestAffectionLevel {
        .from(points: self.affection)
    }

    /// Intensity label: "strong", "moderate", or "subtle".
    public var intensityLabel: String {
        if self.intensity > 0.7 { return "strong" }
        if self.intensity > 0.4 { return "moderate" }
        return "subtle"
    }

    /// Time since last mood change.
    public var timeSinceChange: TimeInterval {
        let nowMs = Date().timeIntervalSince1970 * 1000
        return max(0, (nowMs - self.lastChangeMs) / 1000)
    }

    public init(
        mood: ShittimChestCompanionMood = .neutral,
        intensity: Double = 0.3,
        lastChangeMs: Double = 0,
        triggers: [String] = [],
        affection: Double = 0,
        senseiMood: ShittimChestCompanionMood? = nil,
        senseiIntensity: Double? = nil,
        lastReflectionReason: String? = nil)
    {
        self.mood = mood
        self.intensity = intensity
        self.lastChangeMs = lastChangeMs
        self.triggers = triggers
        self.affection = affection
        self.senseiMood = senseiMood
        self.senseiIntensity = senseiIntensity
        self.lastReflectionReason = lastReflectionReason
    }
}

// MARK: - Mood Display Metadata

extension ShittimChestCompanionMood {
    /// SF Symbol name for each mood.
    public var symbolName: String {
        switch self {
        case .happy: "face.smiling"
        case .neutral: "face.dashed"
        case .sad: "cloud.rain"
        case .excited: "star.fill"
        case .worried: "exclamationmark.triangle"
        case .caring: "heart.fill"
        case .sleepy: "moon.zzz.fill"
        case .bored: "ellipsis.circle"
        case .focused: "eye.fill"
        case .curious: "magnifyingglass"
        case .playful: "sparkles"
        case .grateful: "hands.clap.fill"
        case .nostalgic: "clock.arrow.circlepath"
        }
    }

    /// Emoji representation for each mood.
    public var emoji: String {
        switch self {
        case .happy: "\u{1F60A}"       // 😊
        case .neutral: "\u{1F610}"     // 😐
        case .sad: "\u{1F622}"         // 😢
        case .excited: "\u{1F929}"     // 🤩
        case .worried: "\u{1F630}"     // 😰
        case .caring: "\u{1F970}"      // 🥰
        case .sleepy: "\u{1F634}"      // 😴
        case .bored: "\u{1F971}"       // 🥱
        case .focused: "\u{1F9D0}"     // 🧐
        case .curious: "\u{1F914}"     // 🤔
        case .playful: "\u{1F61C}"     // 😜
        case .grateful: "\u{1F64F}"    // 🙏
        case .nostalgic: "\u{1F4AD}"   // 💭
        }
    }

    /// Display name in Vietnamese.
    public var displayNameVI: String {
        switch self {
        case .happy: "Vui ve"
        case .neutral: "Binh thuong"
        case .sad: "Buon"
        case .excited: "Phan khich"
        case .worried: "Lo lang"
        case .caring: "Quan tam"
        case .sleepy: "Buon ngu"
        case .bored: "Chan"
        case .focused: "Tap trung"
        case .curious: "To mo"
        case .playful: "Nghich ngom"
        case .grateful: "Biet on"
        case .nostalgic: "Hoai niem"
        }
    }

    /// Display name in English.
    public var displayName: String {
        switch self {
        case .happy: "Happy"
        case .neutral: "Neutral"
        case .sad: "Sad"
        case .excited: "Excited"
        case .worried: "Worried"
        case .caring: "Caring"
        case .sleepy: "Sleepy"
        case .bored: "Bored"
        case .focused: "Focused"
        case .curious: "Curious"
        case .playful: "Playful"
        case .grateful: "Grateful"
        case .nostalgic: "Nostalgic"
        }
    }

    /// Accent color for mood display (hex string).
    public var accentColorHex: String {
        switch self {
        case .happy: "#FFD700"      // Gold
        case .neutral: "#A0AEC0"    // Gray
        case .sad: "#63B3ED"        // Light Blue
        case .excited: "#F6AD55"    // Orange
        case .worried: "#FC8181"    // Red-ish
        case .caring: "#F687B3"     // Pink
        case .sleepy: "#9F7AEA"     // Purple
        case .bored: "#B7B7B7"     // Muted Gray
        case .focused: "#48BB78"    // Green
        case .curious: "#4FD1C5"    // Teal
        case .playful: "#F6E05E"    // Yellow
        case .grateful: "#ED8936"   // Warm Orange
        case .nostalgic: "#B794F4"  // Lavender
        }
    }
}

// MARK: - Affection Level Display

extension ShittimChestAffectionLevel {
    /// Display name for affection level.
    public var displayName: String {
        switch self {
        case .stranger: "Moi gap"
        case .acquaintance: "Quen biet"
        case .friend: "Ban be"
        case .closeFriend: "Than thiet"
        case .bestFriend: "Gan bo"
        }
    }

    /// Hearts string for visual display.
    public var hearts: String {
        String(repeating: "\u{2764}\u{FE0F}", count: self.rawValue)
            + String(repeating: "\u{1F5A4}", count: 5 - self.rawValue)
    }
}

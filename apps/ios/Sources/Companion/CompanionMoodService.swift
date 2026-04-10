import Foundation
import OSLog
import ShittimChestKit

/// Fetches and caches Arona's emotional state from the gateway.
///
/// Uses the `companion.mood` RPC method to pull mood data from the backend.
/// Designed to be called periodically by NodeAppModel rather than self-polling.
///
/// Thread-safe and `Sendable` — all mutable state is behind an actor.
actor CompanionMoodService {
    private static let logger = Logger(subsystem: "ai.shittimchest.ios", category: "companion.mood")

    private let gateway: GatewayNodeSession

    /// Last successfully fetched mood state.
    private(set) var currentState: ShittimChestEmotionalState?

    /// Timestamp of last successful fetch.
    private(set) var lastFetchedAt: Date?

    /// Whether a fetch is currently in-flight.
    private var isFetching = false

    init(gateway: GatewayNodeSession) {
        self.gateway = gateway
    }

    // MARK: - Public API

    /// Fetch the current mood state from the gateway.
    ///
    /// Returns `nil` if the gateway returns null (no mood state saved yet)
    /// or if the request fails.
    @discardableResult
    func fetchMood() async -> ShittimChestEmotionalState? {
        guard !self.isFetching else {
            Self.logger.debug("Skipping mood fetch — already in flight")
            return self.currentState
        }

        self.isFetching = true
        defer { self.isFetching = false }

        do {
            let data = try await self.gateway.request(
                method: "companion.mood",
                paramsJSON: nil,
                timeoutSeconds: 10)

            // The gateway returns the EmotionalState object directly as JSON payload,
            // or null if no state exists. When null, the Data will be a JSON `null` literal.
            if let decoded = try? JSONDecoder().decode(ShittimChestEmotionalState.self, from: data) {
                self.currentState = decoded
                self.lastFetchedAt = Date()
                Self.logger.info(
                    "Mood fetched: \(decoded.mood.rawValue, privacy: .public) "
                        + "intensity=\(String(format: "%.2f", decoded.intensity), privacy: .public) "
                        + "affection=\(decoded.affection, privacy: .public)")
                return decoded
            } else {
                // null response or decode failure — no mood state saved yet
                Self.logger.info("Mood fetch returned null — no saved state")
                return nil
            }
        } catch {
            Self.logger.error("Mood fetch failed: \(error.localizedDescription, privacy: .public)")
            return self.currentState // Return cached value on error
        }
    }
}

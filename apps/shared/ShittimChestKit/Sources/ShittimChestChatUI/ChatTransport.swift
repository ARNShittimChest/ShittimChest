import Foundation

public enum ShittimChestChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(ShittimChestChatEventPayload)
    case agent(ShittimChestAgentEventPayload)
    case seqGap
}

public protocol ShittimChestChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> ShittimChestChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [ShittimChestChatAttachmentPayload]) async throws -> ShittimChestChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> ShittimChestChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<ShittimChestChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension ShittimChestChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "ShittimChestChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> ShittimChestChatSessionsListResponse {
        throw NSError(
            domain: "ShittimChestChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}

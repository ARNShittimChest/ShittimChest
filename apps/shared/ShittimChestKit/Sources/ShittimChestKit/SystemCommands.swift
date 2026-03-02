import Foundation

public enum ShittimChestSystemCommand: String, Codable, Sendable {
    case run = "system.run"
    case which = "system.which"
    case notify = "system.notify"
    case execApprovalsGet = "system.execApprovals.get"
    case execApprovalsSet = "system.execApprovals.set"
}

public enum ShittimChestNotificationPriority: String, Codable, Sendable {
    case passive
    case active
    case timeSensitive
}

public enum ShittimChestNotificationDelivery: String, Codable, Sendable {
    case system
    case overlay
    case auto
}

public struct ShittimChestSystemRunParams: Codable, Sendable, Equatable {
    public var command: [String]
    public var rawCommand: String?
    public var cwd: String?
    public var env: [String: String]?
    public var timeoutMs: Int?
    public var needsScreenRecording: Bool?
    public var agentId: String?
    public var sessionKey: String?
    public var approved: Bool?
    public var approvalDecision: String?

    public init(
        command: [String],
        rawCommand: String? = nil,
        cwd: String? = nil,
        env: [String: String]? = nil,
        timeoutMs: Int? = nil,
        needsScreenRecording: Bool? = nil,
        agentId: String? = nil,
        sessionKey: String? = nil,
        approved: Bool? = nil,
        approvalDecision: String? = nil)
    {
        self.command = command
        self.rawCommand = rawCommand
        self.cwd = cwd
        self.env = env
        self.timeoutMs = timeoutMs
        self.needsScreenRecording = needsScreenRecording
        self.agentId = agentId
        self.sessionKey = sessionKey
        self.approved = approved
        self.approvalDecision = approvalDecision
    }
}

public struct ShittimChestSystemWhichParams: Codable, Sendable, Equatable {
    public var bins: [String]

    public init(bins: [String]) {
        self.bins = bins
    }
}

public struct ShittimChestSystemNotifyParams: Codable, Sendable, Equatable {
    public var title: String
    public var body: String
    public var sound: String?
    public var priority: ShittimChestNotificationPriority?
    public var delivery: ShittimChestNotificationDelivery?

    public init(
        title: String,
        body: String,
        sound: String? = nil,
        priority: ShittimChestNotificationPriority? = nil,
        delivery: ShittimChestNotificationDelivery? = nil)
    {
        self.title = title
        self.body = body
        self.sound = sound
        self.priority = priority
        self.delivery = delivery
    }
}

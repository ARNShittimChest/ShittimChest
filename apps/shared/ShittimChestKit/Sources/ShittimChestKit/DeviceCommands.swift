import Foundation

public enum ShittimChestDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
}

public enum ShittimChestBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum ShittimChestThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum ShittimChestNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum ShittimChestNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct ShittimChestBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: ShittimChestBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: ShittimChestBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct ShittimChestThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: ShittimChestThermalState

    public init(state: ShittimChestThermalState) {
        self.state = state
    }
}

public struct ShittimChestStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct ShittimChestNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: ShittimChestNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [ShittimChestNetworkInterfaceType]

    public init(
        status: ShittimChestNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [ShittimChestNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct ShittimChestDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: ShittimChestBatteryStatusPayload
    public var thermal: ShittimChestThermalStatusPayload
    public var storage: ShittimChestStorageStatusPayload
    public var network: ShittimChestNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: ShittimChestBatteryStatusPayload,
        thermal: ShittimChestThermalStatusPayload,
        storage: ShittimChestStorageStatusPayload,
        network: ShittimChestNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct ShittimChestDeviceInfoPayload: Codable, Sendable, Equatable {
    public var deviceName: String
    public var modelIdentifier: String
    public var systemName: String
    public var systemVersion: String
    public var appVersion: String
    public var appBuild: String
    public var locale: String

    public init(
        deviceName: String,
        modelIdentifier: String,
        systemName: String,
        systemVersion: String,
        appVersion: String,
        appBuild: String,
        locale: String)
    {
        self.deviceName = deviceName
        self.modelIdentifier = modelIdentifier
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
    }
}

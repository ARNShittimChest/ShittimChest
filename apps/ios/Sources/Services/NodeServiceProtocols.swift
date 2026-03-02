import CoreLocation
import Foundation
import ShittimChestKit
import UIKit

typealias ShittimChestCameraSnapResult = (format: String, base64: String, width: Int, height: Int)
typealias ShittimChestCameraClipResult = (format: String, base64: String, durationMs: Int, hasAudio: Bool)

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(params: ShittimChestCameraSnapParams) async throws -> ShittimChestCameraSnapResult
    func clip(params: ShittimChestCameraClipParams) async throws -> ShittimChestCameraClipResult
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func ensureAuthorization(mode: ShittimChestLocationMode) async -> CLAuthorizationStatus
    func currentLocation(
        params: ShittimChestLocationGetParams,
        desiredAccuracy: ShittimChestLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    func startLocationUpdates(
        desiredAccuracy: ShittimChestLocationAccuracy,
        significantChangesOnly: Bool) -> AsyncStream<CLLocation>
    func stopLocationUpdates()
    func startMonitoringSignificantLocationChanges(onUpdate: @escaping @Sendable (CLLocation) -> Void)
    func stopMonitoringSignificantLocationChanges()
}

protocol DeviceStatusServicing: Sendable {
    func status() async throws -> ShittimChestDeviceStatusPayload
    func info() -> ShittimChestDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: ShittimChestPhotosLatestParams) async throws -> ShittimChestPhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: ShittimChestContactsSearchParams) async throws -> ShittimChestContactsSearchPayload
    func add(params: ShittimChestContactsAddParams) async throws -> ShittimChestContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: ShittimChestCalendarEventsParams) async throws -> ShittimChestCalendarEventsPayload
    func add(params: ShittimChestCalendarAddParams) async throws -> ShittimChestCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: ShittimChestRemindersListParams) async throws -> ShittimChestRemindersListPayload
    func add(params: ShittimChestRemindersAddParams) async throws -> ShittimChestRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: ShittimChestMotionActivityParams) async throws -> ShittimChestMotionActivityPayload
    func pedometer(params: ShittimChestPedometerParams) async throws -> ShittimChestPedometerPayload
}

struct WatchMessagingStatus: Sendable, Equatable {
    var supported: Bool
    var paired: Bool
    var appInstalled: Bool
    var reachable: Bool
    var activationState: String
}

struct WatchQuickReplyEvent: Sendable, Equatable {
    var replyId: String
    var promptId: String
    var actionId: String
    var actionLabel: String?
    var sessionKey: String?
    var note: String?
    var sentAtMs: Int?
    var transport: String
}

struct WatchNotificationSendResult: Sendable, Equatable {
    var deliveredImmediately: Bool
    var queuedForDelivery: Bool
    var transport: String
}

protocol WatchMessagingServicing: AnyObject, Sendable {
    func status() async -> WatchMessagingStatus
    func setReplyHandler(_ handler: (@Sendable (WatchQuickReplyEvent) -> Void)?)
    func sendNotification(
        id: String,
        params: ShittimChestWatchNotifyParams) async throws -> WatchNotificationSendResult
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}

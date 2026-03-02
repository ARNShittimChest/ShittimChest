package ai.shittimchest.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class ShittimChestProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", ShittimChestCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", ShittimChestCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", ShittimChestCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", ShittimChestCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", ShittimChestCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", ShittimChestCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", ShittimChestCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", ShittimChestCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", ShittimChestCapability.Canvas.rawValue)
    assertEquals("camera", ShittimChestCapability.Camera.rawValue)
    assertEquals("screen", ShittimChestCapability.Screen.rawValue)
    assertEquals("voiceWake", ShittimChestCapability.VoiceWake.rawValue)
    assertEquals("location", ShittimChestCapability.Location.rawValue)
    assertEquals("sms", ShittimChestCapability.Sms.rawValue)
    assertEquals("device", ShittimChestCapability.Device.rawValue)
    assertEquals("notifications", ShittimChestCapability.Notifications.rawValue)
    assertEquals("system", ShittimChestCapability.System.rawValue)
    assertEquals("appUpdate", ShittimChestCapability.AppUpdate.rawValue)
    assertEquals("photos", ShittimChestCapability.Photos.rawValue)
    assertEquals("contacts", ShittimChestCapability.Contacts.rawValue)
    assertEquals("calendar", ShittimChestCapability.Calendar.rawValue)
    assertEquals("motion", ShittimChestCapability.Motion.rawValue)
  }

  @Test
  fun cameraCommandsUseStableStrings() {
    assertEquals("camera.list", ShittimChestCameraCommand.List.rawValue)
    assertEquals("camera.snap", ShittimChestCameraCommand.Snap.rawValue)
    assertEquals("camera.clip", ShittimChestCameraCommand.Clip.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", ShittimChestScreenCommand.Record.rawValue)
  }

  @Test
  fun notificationsCommandsUseStableStrings() {
    assertEquals("notifications.list", ShittimChestNotificationsCommand.List.rawValue)
    assertEquals("notifications.actions", ShittimChestNotificationsCommand.Actions.rawValue)
  }

  @Test
  fun deviceCommandsUseStableStrings() {
    assertEquals("device.status", ShittimChestDeviceCommand.Status.rawValue)
    assertEquals("device.info", ShittimChestDeviceCommand.Info.rawValue)
    assertEquals("device.permissions", ShittimChestDeviceCommand.Permissions.rawValue)
    assertEquals("device.health", ShittimChestDeviceCommand.Health.rawValue)
  }

  @Test
  fun systemCommandsUseStableStrings() {
    assertEquals("system.notify", ShittimChestSystemCommand.Notify.rawValue)
  }

  @Test
  fun photosCommandsUseStableStrings() {
    assertEquals("photos.latest", ShittimChestPhotosCommand.Latest.rawValue)
  }

  @Test
  fun contactsCommandsUseStableStrings() {
    assertEquals("contacts.search", ShittimChestContactsCommand.Search.rawValue)
    assertEquals("contacts.add", ShittimChestContactsCommand.Add.rawValue)
  }

  @Test
  fun calendarCommandsUseStableStrings() {
    assertEquals("calendar.events", ShittimChestCalendarCommand.Events.rawValue)
    assertEquals("calendar.add", ShittimChestCalendarCommand.Add.rawValue)
  }

  @Test
  fun motionCommandsUseStableStrings() {
    assertEquals("motion.activity", ShittimChestMotionCommand.Activity.rawValue)
    assertEquals("motion.pedometer", ShittimChestMotionCommand.Pedometer.rawValue)
  }
}

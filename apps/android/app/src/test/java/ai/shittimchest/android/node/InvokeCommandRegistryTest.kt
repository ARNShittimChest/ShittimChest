package ai.shittimchest.android.node

import ai.shittimchest.android.protocol.ShittimChestCalendarCommand
import ai.shittimchest.android.protocol.ShittimChestCameraCommand
import ai.shittimchest.android.protocol.ShittimChestCapability
import ai.shittimchest.android.protocol.ShittimChestContactsCommand
import ai.shittimchest.android.protocol.ShittimChestDeviceCommand
import ai.shittimchest.android.protocol.ShittimChestLocationCommand
import ai.shittimchest.android.protocol.ShittimChestMotionCommand
import ai.shittimchest.android.protocol.ShittimChestNotificationsCommand
import ai.shittimchest.android.protocol.ShittimChestPhotosCommand
import ai.shittimchest.android.protocol.ShittimChestSmsCommand
import ai.shittimchest.android.protocol.ShittimChestSystemCommand
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InvokeCommandRegistryTest {
  @Test
  fun advertisedCapabilities_respectsFeatureAvailability() {
    val capabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        NodeRuntimeFlags(
          cameraEnabled = false,
          locationEnabled = false,
          smsAvailable = false,
          voiceWakeEnabled = false,
          motionActivityAvailable = false,
          motionPedometerAvailable = false,
          debugBuild = false,
        ),
      )

    assertTrue(capabilities.contains(ShittimChestCapability.Canvas.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Screen.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Device.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Notifications.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.System.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.AppUpdate.rawValue))
    assertFalse(capabilities.contains(ShittimChestCapability.Camera.rawValue))
    assertFalse(capabilities.contains(ShittimChestCapability.Location.rawValue))
    assertFalse(capabilities.contains(ShittimChestCapability.Sms.rawValue))
    assertFalse(capabilities.contains(ShittimChestCapability.VoiceWake.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Photos.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Contacts.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Calendar.rawValue))
    assertFalse(capabilities.contains(ShittimChestCapability.Motion.rawValue))
  }

  @Test
  fun advertisedCapabilities_includesFeatureCapabilitiesWhenEnabled() {
    val capabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        NodeRuntimeFlags(
          cameraEnabled = true,
          locationEnabled = true,
          smsAvailable = true,
          voiceWakeEnabled = true,
          motionActivityAvailable = true,
          motionPedometerAvailable = true,
          debugBuild = false,
        ),
      )

    assertTrue(capabilities.contains(ShittimChestCapability.Canvas.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Screen.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Device.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Notifications.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.System.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.AppUpdate.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Camera.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Location.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Sms.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.VoiceWake.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Photos.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Contacts.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Calendar.rawValue))
    assertTrue(capabilities.contains(ShittimChestCapability.Motion.rawValue))
  }

  @Test
  fun advertisedCommands_respectsFeatureAvailability() {
    val commands =
      InvokeCommandRegistry.advertisedCommands(
        NodeRuntimeFlags(
          cameraEnabled = false,
          locationEnabled = false,
          smsAvailable = false,
          voiceWakeEnabled = false,
          motionActivityAvailable = false,
          motionPedometerAvailable = false,
          debugBuild = false,
        ),
      )

    assertFalse(commands.contains(ShittimChestCameraCommand.Snap.rawValue))
    assertFalse(commands.contains(ShittimChestCameraCommand.Clip.rawValue))
    assertFalse(commands.contains(ShittimChestCameraCommand.List.rawValue))
    assertFalse(commands.contains(ShittimChestLocationCommand.Get.rawValue))
    assertTrue(commands.contains(ShittimChestDeviceCommand.Status.rawValue))
    assertTrue(commands.contains(ShittimChestDeviceCommand.Info.rawValue))
    assertTrue(commands.contains(ShittimChestDeviceCommand.Permissions.rawValue))
    assertTrue(commands.contains(ShittimChestDeviceCommand.Health.rawValue))
    assertTrue(commands.contains(ShittimChestNotificationsCommand.List.rawValue))
    assertTrue(commands.contains(ShittimChestNotificationsCommand.Actions.rawValue))
    assertTrue(commands.contains(ShittimChestSystemCommand.Notify.rawValue))
    assertTrue(commands.contains(ShittimChestPhotosCommand.Latest.rawValue))
    assertTrue(commands.contains(ShittimChestContactsCommand.Search.rawValue))
    assertTrue(commands.contains(ShittimChestContactsCommand.Add.rawValue))
    assertTrue(commands.contains(ShittimChestCalendarCommand.Events.rawValue))
    assertTrue(commands.contains(ShittimChestCalendarCommand.Add.rawValue))
    assertFalse(commands.contains(ShittimChestMotionCommand.Activity.rawValue))
    assertFalse(commands.contains(ShittimChestMotionCommand.Pedometer.rawValue))
    assertFalse(commands.contains(ShittimChestSmsCommand.Send.rawValue))
    assertFalse(commands.contains("debug.logs"))
    assertFalse(commands.contains("debug.ed25519"))
    assertTrue(commands.contains("app.update"))
  }

  @Test
  fun advertisedCommands_includesFeatureCommandsWhenEnabled() {
    val commands =
      InvokeCommandRegistry.advertisedCommands(
        NodeRuntimeFlags(
          cameraEnabled = true,
          locationEnabled = true,
          smsAvailable = true,
          voiceWakeEnabled = false,
          motionActivityAvailable = true,
          motionPedometerAvailable = true,
          debugBuild = true,
        ),
      )

    assertTrue(commands.contains(ShittimChestCameraCommand.Snap.rawValue))
    assertTrue(commands.contains(ShittimChestCameraCommand.Clip.rawValue))
    assertTrue(commands.contains(ShittimChestCameraCommand.List.rawValue))
    assertTrue(commands.contains(ShittimChestLocationCommand.Get.rawValue))
    assertTrue(commands.contains(ShittimChestDeviceCommand.Status.rawValue))
    assertTrue(commands.contains(ShittimChestDeviceCommand.Info.rawValue))
    assertTrue(commands.contains(ShittimChestDeviceCommand.Permissions.rawValue))
    assertTrue(commands.contains(ShittimChestDeviceCommand.Health.rawValue))
    assertTrue(commands.contains(ShittimChestNotificationsCommand.List.rawValue))
    assertTrue(commands.contains(ShittimChestNotificationsCommand.Actions.rawValue))
    assertTrue(commands.contains(ShittimChestSystemCommand.Notify.rawValue))
    assertTrue(commands.contains(ShittimChestPhotosCommand.Latest.rawValue))
    assertTrue(commands.contains(ShittimChestContactsCommand.Search.rawValue))
    assertTrue(commands.contains(ShittimChestContactsCommand.Add.rawValue))
    assertTrue(commands.contains(ShittimChestCalendarCommand.Events.rawValue))
    assertTrue(commands.contains(ShittimChestCalendarCommand.Add.rawValue))
    assertTrue(commands.contains(ShittimChestMotionCommand.Activity.rawValue))
    assertTrue(commands.contains(ShittimChestMotionCommand.Pedometer.rawValue))
    assertTrue(commands.contains(ShittimChestSmsCommand.Send.rawValue))
    assertTrue(commands.contains("debug.logs"))
    assertTrue(commands.contains("debug.ed25519"))
    assertTrue(commands.contains("app.update"))
  }

  @Test
  fun advertisedCommands_onlyIncludesSupportedMotionCommands() {
    val commands =
      InvokeCommandRegistry.advertisedCommands(
        NodeRuntimeFlags(
          cameraEnabled = false,
          locationEnabled = false,
          smsAvailable = false,
          voiceWakeEnabled = false,
          motionActivityAvailable = true,
          motionPedometerAvailable = false,
          debugBuild = false,
        ),
      )

    assertTrue(commands.contains(ShittimChestMotionCommand.Activity.rawValue))
    assertFalse(commands.contains(ShittimChestMotionCommand.Pedometer.rawValue))
  }
}

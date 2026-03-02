package ai.shittimchest.android.node

import ai.shittimchest.android.protocol.ShittimChestCalendarCommand
import ai.shittimchest.android.protocol.ShittimChestCanvasA2UICommand
import ai.shittimchest.android.protocol.ShittimChestCanvasCommand
import ai.shittimchest.android.protocol.ShittimChestCameraCommand
import ai.shittimchest.android.protocol.ShittimChestCapability
import ai.shittimchest.android.protocol.ShittimChestContactsCommand
import ai.shittimchest.android.protocol.ShittimChestDeviceCommand
import ai.shittimchest.android.protocol.ShittimChestLocationCommand
import ai.shittimchest.android.protocol.ShittimChestMotionCommand
import ai.shittimchest.android.protocol.ShittimChestNotificationsCommand
import ai.shittimchest.android.protocol.ShittimChestPhotosCommand
import ai.shittimchest.android.protocol.ShittimChestScreenCommand
import ai.shittimchest.android.protocol.ShittimChestSmsCommand
import ai.shittimchest.android.protocol.ShittimChestSystemCommand

data class NodeRuntimeFlags(
  val cameraEnabled: Boolean,
  val locationEnabled: Boolean,
  val smsAvailable: Boolean,
  val voiceWakeEnabled: Boolean,
  val motionActivityAvailable: Boolean,
  val motionPedometerAvailable: Boolean,
  val debugBuild: Boolean,
)

enum class InvokeCommandAvailability {
  Always,
  CameraEnabled,
  LocationEnabled,
  SmsAvailable,
  MotionActivityAvailable,
  MotionPedometerAvailable,
  DebugBuild,
}

enum class NodeCapabilityAvailability {
  Always,
  CameraEnabled,
  LocationEnabled,
  SmsAvailable,
  VoiceWakeEnabled,
  MotionAvailable,
}

data class NodeCapabilitySpec(
  val name: String,
  val availability: NodeCapabilityAvailability = NodeCapabilityAvailability.Always,
)

data class InvokeCommandSpec(
  val name: String,
  val requiresForeground: Boolean = false,
  val availability: InvokeCommandAvailability = InvokeCommandAvailability.Always,
)

object InvokeCommandRegistry {
  val capabilityManifest: List<NodeCapabilitySpec> =
    listOf(
      NodeCapabilitySpec(name = ShittimChestCapability.Canvas.rawValue),
      NodeCapabilitySpec(name = ShittimChestCapability.Screen.rawValue),
      NodeCapabilitySpec(name = ShittimChestCapability.Device.rawValue),
      NodeCapabilitySpec(name = ShittimChestCapability.Notifications.rawValue),
      NodeCapabilitySpec(name = ShittimChestCapability.System.rawValue),
      NodeCapabilitySpec(name = ShittimChestCapability.AppUpdate.rawValue),
      NodeCapabilitySpec(
        name = ShittimChestCapability.Camera.rawValue,
        availability = NodeCapabilityAvailability.CameraEnabled,
      ),
      NodeCapabilitySpec(
        name = ShittimChestCapability.Sms.rawValue,
        availability = NodeCapabilityAvailability.SmsAvailable,
      ),
      NodeCapabilitySpec(
        name = ShittimChestCapability.VoiceWake.rawValue,
        availability = NodeCapabilityAvailability.VoiceWakeEnabled,
      ),
      NodeCapabilitySpec(
        name = ShittimChestCapability.Location.rawValue,
        availability = NodeCapabilityAvailability.LocationEnabled,
      ),
      NodeCapabilitySpec(name = ShittimChestCapability.Photos.rawValue),
      NodeCapabilitySpec(name = ShittimChestCapability.Contacts.rawValue),
      NodeCapabilitySpec(name = ShittimChestCapability.Calendar.rawValue),
      NodeCapabilitySpec(
        name = ShittimChestCapability.Motion.rawValue,
        availability = NodeCapabilityAvailability.MotionAvailable,
      ),
    )

  val all: List<InvokeCommandSpec> =
    listOf(
      InvokeCommandSpec(
        name = ShittimChestCanvasCommand.Present.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = ShittimChestCanvasCommand.Hide.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = ShittimChestCanvasCommand.Navigate.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = ShittimChestCanvasCommand.Eval.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = ShittimChestCanvasCommand.Snapshot.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = ShittimChestCanvasA2UICommand.Push.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = ShittimChestCanvasA2UICommand.PushJSONL.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = ShittimChestCanvasA2UICommand.Reset.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = ShittimChestScreenCommand.Record.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = ShittimChestSystemCommand.Notify.rawValue,
      ),
      InvokeCommandSpec(
        name = ShittimChestCameraCommand.List.rawValue,
        requiresForeground = true,
        availability = InvokeCommandAvailability.CameraEnabled,
      ),
      InvokeCommandSpec(
        name = ShittimChestCameraCommand.Snap.rawValue,
        requiresForeground = true,
        availability = InvokeCommandAvailability.CameraEnabled,
      ),
      InvokeCommandSpec(
        name = ShittimChestCameraCommand.Clip.rawValue,
        requiresForeground = true,
        availability = InvokeCommandAvailability.CameraEnabled,
      ),
      InvokeCommandSpec(
        name = ShittimChestLocationCommand.Get.rawValue,
        availability = InvokeCommandAvailability.LocationEnabled,
      ),
      InvokeCommandSpec(
        name = ShittimChestDeviceCommand.Status.rawValue,
      ),
      InvokeCommandSpec(
        name = ShittimChestDeviceCommand.Info.rawValue,
      ),
      InvokeCommandSpec(
        name = ShittimChestDeviceCommand.Permissions.rawValue,
      ),
      InvokeCommandSpec(
        name = ShittimChestDeviceCommand.Health.rawValue,
      ),
      InvokeCommandSpec(
        name = ShittimChestNotificationsCommand.List.rawValue,
      ),
      InvokeCommandSpec(
        name = ShittimChestNotificationsCommand.Actions.rawValue,
      ),
      InvokeCommandSpec(
        name = ShittimChestPhotosCommand.Latest.rawValue,
      ),
      InvokeCommandSpec(
        name = ShittimChestContactsCommand.Search.rawValue,
      ),
      InvokeCommandSpec(
        name = ShittimChestContactsCommand.Add.rawValue,
      ),
      InvokeCommandSpec(
        name = ShittimChestCalendarCommand.Events.rawValue,
      ),
      InvokeCommandSpec(
        name = ShittimChestCalendarCommand.Add.rawValue,
      ),
      InvokeCommandSpec(
        name = ShittimChestMotionCommand.Activity.rawValue,
        availability = InvokeCommandAvailability.MotionActivityAvailable,
      ),
      InvokeCommandSpec(
        name = ShittimChestMotionCommand.Pedometer.rawValue,
        availability = InvokeCommandAvailability.MotionPedometerAvailable,
      ),
      InvokeCommandSpec(
        name = ShittimChestSmsCommand.Send.rawValue,
        availability = InvokeCommandAvailability.SmsAvailable,
      ),
      InvokeCommandSpec(
        name = "debug.logs",
        availability = InvokeCommandAvailability.DebugBuild,
      ),
      InvokeCommandSpec(
        name = "debug.ed25519",
        availability = InvokeCommandAvailability.DebugBuild,
      ),
      InvokeCommandSpec(name = "app.update"),
    )

  private val byNameInternal: Map<String, InvokeCommandSpec> = all.associateBy { it.name }

  fun find(command: String): InvokeCommandSpec? = byNameInternal[command]

  fun advertisedCapabilities(flags: NodeRuntimeFlags): List<String> {
    return capabilityManifest
      .filter { spec ->
        when (spec.availability) {
          NodeCapabilityAvailability.Always -> true
          NodeCapabilityAvailability.CameraEnabled -> flags.cameraEnabled
          NodeCapabilityAvailability.LocationEnabled -> flags.locationEnabled
          NodeCapabilityAvailability.SmsAvailable -> flags.smsAvailable
          NodeCapabilityAvailability.VoiceWakeEnabled -> flags.voiceWakeEnabled
          NodeCapabilityAvailability.MotionAvailable -> flags.motionActivityAvailable || flags.motionPedometerAvailable
        }
      }
      .map { it.name }
  }

  fun advertisedCommands(flags: NodeRuntimeFlags): List<String> {
    return all
      .filter { spec ->
        when (spec.availability) {
          InvokeCommandAvailability.Always -> true
          InvokeCommandAvailability.CameraEnabled -> flags.cameraEnabled
          InvokeCommandAvailability.LocationEnabled -> flags.locationEnabled
          InvokeCommandAvailability.SmsAvailable -> flags.smsAvailable
          InvokeCommandAvailability.MotionActivityAvailable -> flags.motionActivityAvailable
          InvokeCommandAvailability.MotionPedometerAvailable -> flags.motionPedometerAvailable
          InvokeCommandAvailability.DebugBuild -> flags.debugBuild
        }
      }
      .map { it.name }
  }
}

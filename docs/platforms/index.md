---
summary: "Platform support overview (Gateway + companion apps)"
read_when:
  - Looking for OS support or install paths
  - Deciding where to run the Gateway
title: "Platforms"
---

# Platforms

ShittimChest core is written in TypeScript. **Node is the recommended runtime**.
Bun is not recommended for the Gateway (WhatsApp/Telegram bugs).

Companion apps exist for macOS (menu bar app) and mobile nodes (iOS/Android). Windows and
Linux companion apps are planned, but the Gateway is fully supported today.
Native companion apps for Windows are also planned; the Gateway is recommended via WSL2.

## Choose your OS

- macOS: [macOS](/platforms/macos)
- iOS: [iOS](/platforms/ios)
- Android: [Android](/platforms/android)
- Windows: [Windows](/platforms/windows)
- Linux: [Linux](/platforms/linux)

## VPS & hosting

- VPS hub: [VPS hosting](/vps)
- Fly.io: [Fly.io](/install/fly)
- Hetzner (Docker): [Hetzner](/install/hetzner)
- GCP (Compute Engine): [GCP](/install/gcp)
- exe.dev (VM + HTTPS proxy): [exe.dev](/install/exe-dev)

## Common links

- Install guide: [Getting Started](/start/getting-started)
- Gateway runbook: [Gateway](/gateway)
- Gateway configuration: [Configuration](/gateway/configuration)
- Service status: `shittimchest gateway status`

## Gateway service install (CLI)

Use one of these (all supported):

- Wizard (recommended): `shittimchest onboard --install-daemon`
- Direct: `shittimchest gateway install`
- Configure flow: `shittimchest configure` → select **Gateway service**
- Repair/migrate: `shittimchest doctor` (offers to install or fix the service)

The service target depends on OS:

- macOS: LaunchAgent (`ai.shittimchest.gateway` or `ai.shittimchest.<profile>`; legacy `com.shittimchest.*`)
- Linux/WSL2: systemd user service (`shittimchest-gateway[-<profile>].service`)

---
summary: "Run ShittimChest in a rootless Podman container"
read_when:
  - You want a containerized gateway with Podman instead of Docker
title: "Podman"
---

# Podman

Run the ShittimChest gateway in a **rootless** Podman container. Uses the same image as Docker (build from the repo [Dockerfile](https://github.com/shittimchest/shittimchest/blob/main/Dockerfile)).

## Requirements

- Podman (rootless)
- Sudo for one-time setup (create user, build image)

## Quick start

**1. One-time setup** (from repo root; creates user, builds image, installs launch script):

```bash
./setup-podman.sh
```

This also creates a minimal `~shittimchest/.shittimchest/shittimchest.json` (sets `gateway.mode="local"`) so the gateway can start without running the wizard.

By default the container is **not** installed as a systemd service, you start it manually (see below). For a production-style setup with auto-start and restarts, install it as a systemd Quadlet user service instead:

```bash
./setup-podman.sh --quadlet
```

(Or set `SHITTIMCHEST_PODMAN_QUADLET=1`; use `--container` to install only the container and launch script.)

**2. Start gateway** (manual, for quick smoke testing):

```bash
./scripts/run-shittimchest-podman.sh launch
```

**3. Onboarding wizard** (e.g. to add channels or providers):

```bash
./scripts/run-shittimchest-podman.sh launch setup
```

Then open `http://127.0.0.1:18789/` and use the token from `~shittimchest/.shittimchest/.env` (or the value printed by setup).

## Systemd (Quadlet, optional)

If you ran `./setup-podman.sh --quadlet` (or `SHITTIMCHEST_PODMAN_QUADLET=1`), a [Podman Quadlet](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html) unit is installed so the gateway runs as a systemd user service for the shittimchest user. The service is enabled and started at the end of setup.

- **Start:** `sudo systemctl --machine shittimchest@ --user start shittimchest.service`
- **Stop:** `sudo systemctl --machine shittimchest@ --user stop shittimchest.service`
- **Status:** `sudo systemctl --machine shittimchest@ --user status shittimchest.service`
- **Logs:** `sudo journalctl --machine shittimchest@ --user -u shittimchest.service -f`

The quadlet file lives at `~shittimchest/.config/containers/systemd/shittimchest.container`. To change ports or env, edit that file (or the `.env` it sources), then `sudo systemctl --machine shittimchest@ --user daemon-reload` and restart the service. On boot, the service starts automatically if lingering is enabled for shittimchest (setup does this when loginctl is available).

To add quadlet **after** an initial setup that did not use it, re-run: `./setup-podman.sh --quadlet`.

## The shittimchest user (non-login)

`setup-podman.sh` creates a dedicated system user `shittimchest`:

- **Shell:** `nologin` — no interactive login; reduces attack surface.
- **Home:** e.g. `/home/shittimchest` — holds `~/.shittimchest` (config, workspace) and the launch script `run-shittimchest-podman.sh`.
- **Rootless Podman:** The user must have a **subuid** and **subgid** range. Many distros assign these automatically when the user is created. If setup prints a warning, add lines to `/etc/subuid` and `/etc/subgid`:

  ```text
  shittimchest:100000:65536
  ```

  Then start the gateway as that user (e.g. from cron or systemd):

  ```bash
  sudo -u shittimchest /home/shittimchest/run-shittimchest-podman.sh
  sudo -u shittimchest /home/shittimchest/run-shittimchest-podman.sh setup
  ```

- **Config:** Only `shittimchest` and root can access `/home/shittimchest/.shittimchest`. To edit config: use the Control UI once the gateway is running, or `sudo -u shittimchest $EDITOR /home/shittimchest/.shittimchest/shittimchest.json`.

## Environment and config

- **Token:** Stored in `~shittimchest/.shittimchest/.env` as `SHITTIMCHEST_GATEWAY_TOKEN`. `setup-podman.sh` and `run-shittimchest-podman.sh` generate it if missing (uses `openssl`, `python3`, or `od`).
- **Optional:** In that `.env` you can set provider keys (e.g. `GROQ_API_KEY`, `OLLAMA_API_KEY`) and other ShittimChest env vars.
- **Host ports:** By default the script maps `18789` (gateway) and `18790` (bridge). Override the **host** port mapping with `SHITTIMCHEST_PODMAN_GATEWAY_HOST_PORT` and `SHITTIMCHEST_PODMAN_BRIDGE_HOST_PORT` when launching.
- **Gateway bind:** By default, `run-shittimchest-podman.sh` starts the gateway with `--bind loopback` for safe local access. To expose on LAN, set `SHITTIMCHEST_GATEWAY_BIND=lan` and configure `gateway.controlUi.allowedOrigins` (or explicitly enable host-header fallback) in `shittimchest.json`.
- **Paths:** Host config and workspace default to `~shittimchest/.shittimchest` and `~shittimchest/.shittimchest/workspace`. Override the host paths used by the launch script with `SHITTIMCHEST_CONFIG_DIR` and `SHITTIMCHEST_WORKSPACE_DIR`.

## Useful commands

- **Logs:** With quadlet: `sudo journalctl --machine shittimchest@ --user -u shittimchest.service -f`. With script: `sudo -u shittimchest podman logs -f shittimchest`
- **Stop:** With quadlet: `sudo systemctl --machine shittimchest@ --user stop shittimchest.service`. With script: `sudo -u shittimchest podman stop shittimchest`
- **Start again:** With quadlet: `sudo systemctl --machine shittimchest@ --user start shittimchest.service`. With script: re-run the launch script or `podman start shittimchest`
- **Remove container:** `sudo -u shittimchest podman rm -f shittimchest` — config and workspace on the host are kept

## Troubleshooting

- **Permission denied (EACCES) on config or auth-profiles:** The container defaults to `--userns=keep-id` and runs as the same uid/gid as the host user running the script. Ensure your host `SHITTIMCHEST_CONFIG_DIR` and `SHITTIMCHEST_WORKSPACE_DIR` are owned by that user.
- **Gateway start blocked (missing `gateway.mode=local`):** Ensure `~shittimchest/.shittimchest/shittimchest.json` exists and sets `gateway.mode="local"`. `setup-podman.sh` creates this file if missing.
- **Rootless Podman fails for user shittimchest:** Check `/etc/subuid` and `/etc/subgid` contain a line for `shittimchest` (e.g. `shittimchest:100000:65536`). Add it if missing and restart.
- **Container name in use:** The launch script uses `podman run --replace`, so the existing container is replaced when you start again. To clean up manually: `podman rm -f shittimchest`.
- **Script not found when running as shittimchest:** Ensure `setup-podman.sh` was run so that `run-shittimchest-podman.sh` is copied to shittimchest’s home (e.g. `/home/shittimchest/run-shittimchest-podman.sh`).
- **Quadlet service not found or fails to start:** Run `sudo systemctl --machine shittimchest@ --user daemon-reload` after editing the `.container` file. Quadlet requires cgroups v2: `podman info --format '{{.Host.CgroupsVersion}}'` should show `2`.

## Optional: run as your own user

To run the gateway as your normal user (no dedicated shittimchest user): build the image, create `~/.shittimchest/.env` with `SHITTIMCHEST_GATEWAY_TOKEN`, and run the container with `--userns=keep-id` and mounts to your `~/.shittimchest`. The launch script is designed for the shittimchest-user flow; for a single-user setup you can instead run the `podman run` command from the script manually, pointing config and workspace to your home. Recommended for most users: use `setup-podman.sh` and run as the shittimchest user so config and process are isolated.

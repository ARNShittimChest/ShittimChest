---
summary: "CLI reference for `shittimchest daemon` (legacy alias for gateway service management)"
read_when:
  - You still use `shittimchest daemon ...` in scripts
  - You need service lifecycle commands (install/start/stop/restart/status)
title: "daemon"
---

# `shittimchest daemon`

Legacy alias for Gateway service management commands.

`shittimchest daemon ...` maps to the same service control surface as `shittimchest gateway ...` service commands.

## Usage

```bash
shittimchest daemon status
shittimchest daemon install
shittimchest daemon start
shittimchest daemon stop
shittimchest daemon restart
shittimchest daemon uninstall
```

## Subcommands

- `status`: show service install state and probe Gateway health
- `install`: install service (`launchd`/`systemd`/`schtasks`)
- `uninstall`: remove service
- `start`: start service
- `stop`: stop service
- `restart`: restart service

## Common options

- `status`: `--url`, `--token`, `--password`, `--timeout`, `--no-probe`, `--deep`, `--json`
- `install`: `--port`, `--runtime <node|bun>`, `--token`, `--force`, `--json`
- lifecycle (`uninstall|start|stop|restart`): `--json`

## Prefer

Use [`shittimchest gateway`](/cli/gateway) for current docs and examples.

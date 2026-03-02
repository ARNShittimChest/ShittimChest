---
summary: "CLI reference for `shittimchest config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
title: "config"
---

# `shittimchest config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `shittimchest configure`).

## Examples

```bash
shittimchest config get browser.executablePath
shittimchest config set browser.executablePath "/usr/bin/google-chrome"
shittimchest config set agents.defaults.heartbeat.every "2h"
shittimchest config set agents.list[0].tools.exec.node "node-id-or-name"
shittimchest config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
shittimchest config get agents.defaults.workspace
shittimchest config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
shittimchest config get agents.list
shittimchest config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--strict-json` to require JSON5 parsing. `--json` remains supported as a legacy alias.

```bash
shittimchest config set agents.defaults.heartbeat.every "0m"
shittimchest config set gateway.port 19001 --strict-json
shittimchest config set channels.whatsapp.groups '["*"]' --strict-json
```

Restart the gateway after edits.

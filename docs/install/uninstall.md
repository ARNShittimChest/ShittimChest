---
summary: "Uninstall ShittimChest completely (CLI, service, state, workspace)"
read_when:
  - You want to remove ShittimChest from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Easy path** if `shittimchest` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
shittimchest uninstall
```

Non-interactive (automation / npx):

```bash
shittimchest uninstall --all --yes --non-interactive
npx -y shittimchest uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
shittimchest gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
shittimchest gateway uninstall
```

3. Delete state + config:

```bash
rm -rf "${SHITTIMCHEST_STATE_DIR:-$HOME/.shittimchest}"
```

If you set `SHITTIMCHEST_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.shittimchest/workspace
```

5. Remove the CLI install (pick the one you used):

```bash
npm rm -g shittimchest
pnpm remove -g shittimchest
bun remove -g shittimchest
```

6. If you installed the macOS app:

```bash
rm -rf /Applications/ShittimChest.app
```

Notes:

- If you used profiles (`--profile` / `SHITTIMCHEST_PROFILE`), repeat step 3 for each state dir (defaults are `~/.shittimchest-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `shittimchest` is missing.

### macOS (launchd)

Default label is `ai.shittimchest.gateway` (or `ai.shittimchest.<profile>`; legacy `com.shittimchest.*` may still exist):

```bash
launchctl bootout gui/$UID/ai.shittimchest.gateway
rm -f ~/Library/LaunchAgents/ai.shittimchest.gateway.plist
```

If you used a profile, replace the label and plist name with `ai.shittimchest.<profile>`. Remove any legacy `com.shittimchest.*` plists if present.

### Linux (systemd user unit)

Default unit name is `shittimchest-gateway.service` (or `shittimchest-gateway-<profile>.service`):

```bash
systemctl --user disable --now shittimchest-gateway.service
rm -f ~/.config/systemd/user/shittimchest-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `ShittimChest Gateway` (or `ShittimChest Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "ShittimChest Gateway"
Remove-Item -Force "$env:USERPROFILE\.shittimchest\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.shittimchest-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://shittimchest.ai/install.sh` or `install.ps1`, the CLI was installed with `npm install -g shittimchest@latest`.
Remove it with `npm rm -g shittimchest` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `shittimchest ...` / `bun run shittimchest ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.

---
summary: "CLI reference for `shittimchest devices` (device pairing + token rotation/revocation)"
read_when:
  - You are approving device pairing requests
  - You need to rotate or revoke device tokens
title: "devices"
---

# `shittimchest devices`

Manage device pairing requests and device-scoped tokens.

## Commands

### `shittimchest devices list`

List pending pairing requests and paired devices.

```
shittimchest devices list
shittimchest devices list --json
```

### `shittimchest devices remove <deviceId>`

Remove one paired device entry.

```
shittimchest devices remove <deviceId>
shittimchest devices remove <deviceId> --json
```

### `shittimchest devices clear --yes [--pending]`

Clear paired devices in bulk.

```
shittimchest devices clear --yes
shittimchest devices clear --yes --pending
shittimchest devices clear --yes --pending --json
```

### `shittimchest devices approve [requestId] [--latest]`

Approve a pending device pairing request. If `requestId` is omitted, ShittimChest
automatically approves the most recent pending request.

```
shittimchest devices approve
shittimchest devices approve <requestId>
shittimchest devices approve --latest
```

### `shittimchest devices reject <requestId>`

Reject a pending device pairing request.

```
shittimchest devices reject <requestId>
```

### `shittimchest devices rotate --device <id> --role <role> [--scope <scope...>]`

Rotate a device token for a specific role (optionally updating scopes).

```
shittimchest devices rotate --device <deviceId> --role operator --scope operator.read --scope operator.write
```

### `shittimchest devices revoke --device <id> --role <role>`

Revoke a device token for a specific role.

```
shittimchest devices revoke --device <deviceId> --role node
```

## Common options

- `--url <url>`: Gateway WebSocket URL (defaults to `gateway.remote.url` when configured).
- `--token <token>`: Gateway token (if required).
- `--password <password>`: Gateway password (password auth).
- `--timeout <ms>`: RPC timeout.
- `--json`: JSON output (recommended for scripting).

Note: when you set `--url`, the CLI does not fall back to config or environment credentials.
Pass `--token` or `--password` explicitly. Missing explicit credentials is an error.

## Notes

- Token rotation returns a new token (sensitive). Treat it like a secret.
- These commands require `operator.pairing` (or `operator.admin`) scope.
- `devices clear` is intentionally gated by `--yes`.
- If pairing scope is unavailable on local loopback (and no explicit `--url` is passed), list/approve can use a local pairing fallback.

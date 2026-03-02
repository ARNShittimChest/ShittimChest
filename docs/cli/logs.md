---
summary: "CLI reference for `shittimchest logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
title: "logs"
---

# `shittimchest logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
shittimchest logs
shittimchest logs --follow
shittimchest logs --json
shittimchest logs --limit 500
shittimchest logs --local-time
shittimchest logs --follow --local-time
```

Use `--local-time` to render timestamps in your local timezone.

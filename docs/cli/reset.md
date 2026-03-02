---
summary: "CLI reference for `shittimchest reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `shittimchest reset`

Reset local config/state (keeps the CLI installed).

```bash
shittimchest reset
shittimchest reset --dry-run
shittimchest reset --scope config+creds+sessions --yes --non-interactive
```

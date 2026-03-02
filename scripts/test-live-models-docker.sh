#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${SHITTIMCHEST_IMAGE:-${CLAWDBOT_IMAGE:-shittimchest:local}}"
CONFIG_DIR="${SHITTIMCHEST_CONFIG_DIR:-${CLAWDBOT_CONFIG_DIR:-$HOME/.shittimchest}}"
WORKSPACE_DIR="${SHITTIMCHEST_WORKSPACE_DIR:-${CLAWDBOT_WORKSPACE_DIR:-$HOME/.shittimchest/workspace}}"
PROFILE_FILE="${SHITTIMCHEST_PROFILE_FILE:-${CLAWDBOT_PROFILE_FILE:-$HOME/.profile}}"

PROFILE_MOUNT=()
if [[ -f "$PROFILE_FILE" ]]; then
  PROFILE_MOUNT=(-v "$PROFILE_FILE":/home/node/.profile:ro)
fi

echo "==> Build image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" -f "$ROOT_DIR/Dockerfile" "$ROOT_DIR"

echo "==> Run live model tests (profile keys)"
docker run --rm -t \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  -e SHITTIMCHEST_LIVE_TEST=1 \
  -e SHITTIMCHEST_LIVE_MODELS="${SHITTIMCHEST_LIVE_MODELS:-${CLAWDBOT_LIVE_MODELS:-modern}}" \
  -e SHITTIMCHEST_LIVE_PROVIDERS="${SHITTIMCHEST_LIVE_PROVIDERS:-${CLAWDBOT_LIVE_PROVIDERS:-}}" \
  -e SHITTIMCHEST_LIVE_MAX_MODELS="${SHITTIMCHEST_LIVE_MAX_MODELS:-${CLAWDBOT_LIVE_MAX_MODELS:-48}}" \
  -e SHITTIMCHEST_LIVE_MODEL_TIMEOUT_MS="${SHITTIMCHEST_LIVE_MODEL_TIMEOUT_MS:-${CLAWDBOT_LIVE_MODEL_TIMEOUT_MS:-}}" \
  -e SHITTIMCHEST_LIVE_REQUIRE_PROFILE_KEYS="${SHITTIMCHEST_LIVE_REQUIRE_PROFILE_KEYS:-${CLAWDBOT_LIVE_REQUIRE_PROFILE_KEYS:-}}" \
  -v "$CONFIG_DIR":/home/node/.shittimchest \
  -v "$WORKSPACE_DIR":/home/node/.shittimchest/workspace \
  "${PROFILE_MOUNT[@]}" \
  "$IMAGE_NAME" \
  -lc "set -euo pipefail; [ -f \"$HOME/.profile\" ] && source \"$HOME/.profile\" || true; cd /app && pnpm test:live"

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

echo "==> Run gateway live model tests (profile keys)"
docker run --rm -t \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  -e SHITTIMCHEST_LIVE_TEST=1 \
  -e SHITTIMCHEST_LIVE_GATEWAY_MODELS="${SHITTIMCHEST_LIVE_GATEWAY_MODELS:-${CLAWDBOT_LIVE_GATEWAY_MODELS:-modern}}" \
  -e SHITTIMCHEST_LIVE_GATEWAY_PROVIDERS="${SHITTIMCHEST_LIVE_GATEWAY_PROVIDERS:-${CLAWDBOT_LIVE_GATEWAY_PROVIDERS:-}}" \
  -e SHITTIMCHEST_LIVE_GATEWAY_MAX_MODELS="${SHITTIMCHEST_LIVE_GATEWAY_MAX_MODELS:-${CLAWDBOT_LIVE_GATEWAY_MAX_MODELS:-24}}" \
  -e SHITTIMCHEST_LIVE_GATEWAY_MODEL_TIMEOUT_MS="${SHITTIMCHEST_LIVE_GATEWAY_MODEL_TIMEOUT_MS:-${CLAWDBOT_LIVE_GATEWAY_MODEL_TIMEOUT_MS:-}}" \
  -v "$CONFIG_DIR":/home/node/.shittimchest \
  -v "$WORKSPACE_DIR":/home/node/.shittimchest/workspace \
  "${PROFILE_MOUNT[@]}" \
  "$IMAGE_NAME" \
  -lc "set -euo pipefail; [ -f \"$HOME/.profile\" ] && source \"$HOME/.profile\" || true; cd /app && pnpm test:live"

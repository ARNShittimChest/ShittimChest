#!/usr/bin/env bash
set -euo pipefail

cd /repo

export SHITTIMCHEST_STATE_DIR="/tmp/shittimchest-test"
export SHITTIMCHEST_CONFIG_PATH="${SHITTIMCHEST_STATE_DIR}/shittimchest.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${SHITTIMCHEST_STATE_DIR}/credentials"
mkdir -p "${SHITTIMCHEST_STATE_DIR}/agents/main/sessions"
echo '{}' >"${SHITTIMCHEST_CONFIG_PATH}"
echo 'creds' >"${SHITTIMCHEST_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${SHITTIMCHEST_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm shittimchest reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${SHITTIMCHEST_CONFIG_PATH}"
test ! -d "${SHITTIMCHEST_STATE_DIR}/credentials"
test ! -d "${SHITTIMCHEST_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${SHITTIMCHEST_STATE_DIR}/credentials"
echo '{}' >"${SHITTIMCHEST_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm shittimchest uninstall --state --yes --non-interactive

test ! -d "${SHITTIMCHEST_STATE_DIR}"

echo "OK"

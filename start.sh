#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

[ -d node_modules ] || { printf 'Dependencies are missing; run npm ci before startup.\n' >&2; exit 1; }
[ -f dist/index.html ] || { printf 'The production build is missing; run npm run build before startup.\n' >&2; exit 1; }
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
api_port="${API_PORT:-30940}"
ui_port="${UI_PORT:-30941}"
api_host="${API_HOST:-127.0.0.1}"
ui_host="${UI_HOST:-127.0.0.1}"
[ "$api_port" != "$ui_port" ] || { printf 'API_PORT and UI_PORT must be distinct.\n' >&2; exit 1; }
for port in "$api_port" "$ui_port"; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    printf 'Port %s is occupied; refusing to terminate another process.\n' "$port" >&2
    exit 1
  fi
done

cleanup() {
  kill "$api_pid" "$ui_pid" 2>/dev/null || true
  wait "$api_pid" "$ui_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

env API_PORT="$api_port" API_HOST="$api_host" node --no-warnings=ExperimentalWarning api-server.mjs & api_pid=$!
env PORT="$ui_port" HOST="$ui_host" node server.mjs & ui_pid=$!
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$ui_pid" 2>/dev/null; do sleep 1; done
exit 1

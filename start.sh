#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

[ -d node_modules ] || { printf 'Dependencies are missing; run npm ci before startup.\n' >&2; exit 1; }
[ -f dist/index.html ] || { printf 'The production build is missing; run npm run build before startup.\n' >&2; exit 1; }
export PORT="${PORT:-8080}"

exec node server.mjs

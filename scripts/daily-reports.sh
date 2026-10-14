#!/bin/zsh
# Reports every launched campaign. Cron calls this once a day.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="/usr/local/bin/node"
LOG="$ROOT/logs/daily-report.log"
mkdir -p "$ROOT/logs"
cd "$ROOT"

{
  echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) ====="
  if [[ ! -x "$NODE" ]]; then
    echo "Node 22+ not found at $NODE"
    exit 1
  fi

  "$NODE" ./node_modules/typescript/bin/tsc -p "$ROOT/tsconfig.json"
  list="$("$NODE" scripts/run.mjs list)"
  echo "$list"

  printf '%s\n' "$list" | while IFS= read -r line; do
    slug="${line%%$'\t'*}"
    [[ "$slug" =~ '^[a-z0-9]+(-[a-z0-9]+)*$' ]] || continue
    echo "----- report $slug -----"
    "$NODE" scripts/run.mjs report "$slug" || echo "report $slug failed with $?"
  done
} >>"$LOG" 2>&1

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "${NODE_BIN:-}" ]] && [[ -x "${NODE_BIN}" ]]; then
  NODE_CMD="${NODE_BIN}"
elif command -v node >/dev/null 2>&1; then
  NODE_CMD="$(command -v node)"
else
  echo "Error: node not found in PATH. Install Node.js or set NODE_BIN." >&2
  exit 1
fi

exec "${NODE_CMD}" "${SCRIPT_DIR}/build.mjs" "$@"

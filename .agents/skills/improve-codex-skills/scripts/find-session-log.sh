#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  find-session-log.sh --sessionId <id> [--root <dir>] [--output <file>]

Options:
  --sessionId   Codex session id (payload.id from session_meta)
  --root        Sessions root directory (default: $CODEX_SESSIONS_DIR or ~/.codex/sessions)
  --output      Write matching paths to file instead of stdout

Notes:
  This script searches JSONL session logs only.
USAGE
}

session_id=""
root="${CODEX_SESSIONS_DIR:-$HOME/.codex/sessions}"
output=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sessionId=*)
      session_id="${1#*=}"
      shift
      ;;
    --sessionId)
      session_id="${2:-}"
      shift 2
      ;;
    --root=*)
      root="${1#*=}"
      shift
      ;;
    --root)
      root="${2:-}"
      shift 2
      ;;
    --output=*)
      output="${1#*=}"
      shift
      ;;
    --output)
      output="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
 done

if [[ -z "$session_id" ]]; then
  echo "Missing --sessionId" >&2
  usage
  exit 1
fi

if [[ ! -d "$root" ]]; then
  echo "Sessions root not found: $root" >&2
  exit 1
fi

matches=""
if command -v rg >/dev/null 2>&1; then
  matches=$(rg --files -g "*${session_id}*.jsonl" "$root" || true)
  if [[ -z "$matches" ]]; then
    matches=$(rg -l "\"type\"\\s*:\\s*\"session_meta\".*\"id\"\\s*:\\s*\"${session_id}\"" "$root" -g "*.jsonl" || true)
  fi
else
  matches=$(find "$root" -type f -name "*${session_id}*.jsonl" 2>/dev/null || true)
  if [[ -z "$matches" ]]; then
    matches=$(grep -RIl -E "\"type\"[[:space:]]*:[[:space:]]*\"session_meta\".*\"id\"[[:space:]]*:[[:space:]]*\"${session_id}\"" "$root" --include="*.jsonl" 2>/dev/null || true)
  fi
fi

if [[ -z "$matches" ]]; then
  echo "No JSONL session log found for: $session_id" >&2
  exit 2
fi

if [[ -n "$output" ]]; then
  printf "%s\n" "$matches" > "$output"
else
  printf "%s\n" "$matches"
fi

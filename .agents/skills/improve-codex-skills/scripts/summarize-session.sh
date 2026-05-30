#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  summarize-session.sh --log <path> [--out <file>]
  summarize-session.sh --sessionId <id> [--root <dir>] [--out <file>]

Options:
  --log         Path to session .jsonl file
  --sessionId   Codex session id (payload.id from session_meta)
  --root        Sessions root directory (default: $CODEX_SESSIONS_DIR or ~/.codex/sessions)
  --out         Write summary JSON to file instead of stdout
USAGE
}

log_path=""
session_id=""
root="${CODEX_SESSIONS_DIR:-$HOME/.codex/sessions}"
out=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --log=*)
      log_path="${1#*=}"
      shift
      ;;
    --log)
      log_path="${2:-}"
      shift 2
      ;;
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
    --out=*)
      out="${1#*=}"
      shift
      ;;
    --out)
      out="${2:-}"
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

if [[ -z "$log_path" ]]; then
  if [[ -z "$session_id" ]]; then
    echo "Missing --log or --sessionId" >&2
    usage
    exit 1
  fi
  log_path=$("$(dirname "$0")/find-session-log.sh" --sessionId "$session_id" --root "$root" | head -n 1)
fi

if [[ ! -f "$log_path" ]]; then
  echo "Log file not found: $log_path" >&2
  exit 1
fi

if [[ "$log_path" != *.jsonl ]]; then
  echo "Only JSONL session logs are supported (got: $log_path)" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not found in PATH" >&2
  exit 1
fi

summary=$(jq -s '
  def count_by(f):
    (map(f) | map(select(. != null)) | sort | group_by(.) | map({(.[0]): length}) | add) // {};
  {
    meta: (map(select(.type == "session_meta")) | .[0].payload | {
      id,
      timestamp,
      cwd,
      originator,
      cli_version,
      model_provider,
      git
    }),
    counts: {
      total_entries: length,
      types: (count_by(.type)),
      response_item_types: (map(select(.type == "response_item") | .payload.type) | count_by(.)),
      event_msg_types: (map(select(.type == "event_msg") | .payload.type) | count_by(.)),
      message_roles: (map(select(.type == "response_item" and .payload.type == "message") | .payload.role) | count_by(.))
    }
  }
' "$log_path")

if [[ -n "$out" ]]; then
  printf "%s\n" "$summary" > "$out"
else
  printf "%s\n" "$summary"
fi

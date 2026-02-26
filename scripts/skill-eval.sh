#!/usr/bin/env bash
# skill-eval: CLI for tracking whether Cursor agents are following skills' workflow steps.
# Usage:
#   skill-eval start {conversation_id} {skill_name}   -> creates JSON, prints skill_id
#   skill-eval complete {skill_id} {phase_no} [--skipped]  -> appends step
#
# Design: docs/design-decisions/meta-skill-evaluation/
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${REPO_ROOT}/.cursor/logs/skills"
mkdir -p "$LOG_DIR"

gen_uuid() {
  if command -v uuidgen &>/dev/null; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    # Fallback: random hex string
    cat /dev/urandom 2>/dev/null | od -x | head -1 | awk '{print $2$3$4$5$6$7$8}' || echo "fallback-$(date +%s)-$$"
  fi
}

iso_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

filename_ts() {
  date -u +"%Y%m%dT%H%M%SZ"
}

find_file_by_skill_id() {
  local skill_id="$1"
  local f
  for f in "$LOG_DIR"/*_"${skill_id}".json; do
    if [[ -f "$f" ]]; then
      echo "$f"
      return 0
    fi
  done
  return 1
}

cmd_start() {
  local conversation_id="$1"
  local skill_name="$2"
  if [[ -z "$conversation_id" || -z "$skill_name" ]]; then
    echo "Usage: skill-eval start <conversation_id> <skill_name>" >&2
    exit 1
  fi

  local skill_id
  skill_id=$(gen_uuid)
  local ts
  ts=$(filename_ts)
  local now
  now=$(iso_now)
  local file="${LOG_DIR}/${ts}_${skill_name}_${skill_id}.json"

  local json
  json=$(jq -n \
    --arg created_at "$now" \
    --arg conversation_id "$conversation_id" \
    --arg skill_id "$skill_id" \
    --arg skill "$skill_name" \
    '{created_at: $created_at, conversation_id: $conversation_id, skill_id: $skill_id, skill: $skill, steps: []}')

  echo "$json" > "$file"
  echo "$skill_id"
}

cmd_complete() {
  local skill_id="$1"
  local phase_no="$2"
  local skipped="${3:-}"

  if [[ -z "$skill_id" || -z "$phase_no" ]]; then
    echo "Usage: skill-eval complete <skill_id> <phase_no> [--skipped]" >&2
    exit 1
  fi

  local file
  file=$(find_file_by_skill_id "$skill_id") || {
    echo "skill-eval: no file found for skill_id=$skill_id" >&2
    exit 1
  }

  local now
  now=$(iso_now)

  local step
  if [[ "$skipped" == "--skipped" ]]; then
    step=$(jq -n --arg phase "$phase_no" --arg completed_at "$now" '{phase: ($phase | tonumber), completed_at: $completed_at, skipped: true}')
  else
    step=$(jq -n --arg phase "$phase_no" --arg completed_at "$now" '{phase: ($phase | tonumber), completed_at: $completed_at}')
  fi

  jq --argjson step "$step" '.steps += [$step]' "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
}

case "${1:-}" in
  start)
    shift
    cmd_start "$@"
    ;;
  complete)
    shift
    cmd_complete "$1" "$2" "${3:-}"
    ;;
  *)
    echo "Usage: skill-eval {start|complete} ..." >&2
    echo "  skill-eval start <conversation_id> <skill_name>" >&2
    echo "  skill-eval complete <skill_id> <phase_no> [--skipped]" >&2
    exit 1
    ;;
esac

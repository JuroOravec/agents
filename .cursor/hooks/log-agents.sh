#!/usr/bin/env bash
# Log subagent runs to .cursor/logs/agents/agents-YYYY-MM-DD.jsonl
# Runs on subagentStop. Extracts subagent_type, status, duration; computes finished_at and started_at.
#
# After changing this script or hooks.json: Reload Window (Cmd+Shift+P → "Reload Window") for Cursor to pick up changes.
set -e

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_CURSOR="$HOOK_DIR/.."
LOG_BASE="$PROJECT_CURSOR/logs/agents"
DATE_STR=$(date -u +"%Y-%m-%d")
LOG_FILE="$LOG_BASE/agents-$DATE_STR.jsonl"

mkdir -p "$LOG_BASE"

echo "log-agents: logging to $LOG_FILE" >&2

payload=$(cat)
subagent_type=$(echo "$payload" | jq -r '.subagent_type // .type // ""')
status=$(echo "$payload" | jq -r '.status // "completed"')
duration=$(echo "$payload" | jq -r '.duration // 0 | tonumber')

finished_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
start_secs=$(($(date +%s) - duration / 1000))
started_at=$(date -u -r "$start_secs" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "@$start_secs" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "$finished_at")

jq -n -c \
  --arg finished_at "$finished_at" \
  --arg subagent_type "$subagent_type" \
  --arg status "$status" \
  --argjson duration "$duration" \
  --arg started_at "$started_at" \
  '{
    finished_at: $finished_at,
    event: "subagentStop",
    subagent_type: $subagent_type,
    status: $status,
    duration: $duration,
    started_at: $started_at
  }' >> "$LOG_FILE"

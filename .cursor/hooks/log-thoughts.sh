#!/usr/bin/env bash
# Log agent thoughts to .cursor/logs/thoughts/thoughts-YYYY-MM-DD.jsonl
# Runs on afterAgentThought. Truncates text to 100 chars; computes finished_at and started_at.
#
# After changing this script or hooks.json: Reload Window (Cmd+Shift+P → "Reload Window") for Cursor to pick up changes.
set -e

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_CURSOR="$HOOK_DIR/.."
LOG_BASE="$PROJECT_CURSOR/logs/thoughts"
DATE_STR=$(date -u +"%Y-%m-%d")
LOG_FILE="$LOG_BASE/thoughts-$DATE_STR.jsonl"

mkdir -p "$LOG_BASE"

echo "log-thoughts: logging to $LOG_FILE" >&2

payload=$(cat)
text=$(echo "$payload" | jq -r '(.text // "") | if length > 100 then .[0:100] + "…" else . end')
duration_ms=$(echo "$payload" | jq -r '.duration_ms // 0 | tonumber')
conversation_id=$(echo "$payload" | jq -r '.conversation_id // ""')
generation_id=$(echo "$payload" | jq -r '.generation_id // ""')
model=$(echo "$payload" | jq -r '.model // ""')
cursor_version=$(echo "$payload" | jq -r '.cursor_version // ""')

finished_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
start_secs=$(awk -v now="$(date +%s)" -v dur="${duration_ms:-0}" 'BEGIN { print int(now - dur/1000) }')
started_at=$(date -u -r "$start_secs" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "@$start_secs" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "$finished_at")

jq -n -c \
  --arg finished_at "$finished_at" \
  --arg started_at "$started_at" \
  --arg text "$text" \
  --argjson duration_ms "$duration_ms" \
  --arg conversation_id "$conversation_id" \
  --arg generation_id "$generation_id" \
  --arg model "$model" \
  --arg cursor_version "$cursor_version" \
  '{
    finished_at: $finished_at,
    started_at: $started_at,
    event: "agentThought",
    text: $text,
    duration_ms: $duration_ms,
    conversation_id: $conversation_id,
    generation_id: $generation_id,
    model: $model,
    cursor_version: $cursor_version
  }' >> "$LOG_FILE"

echo "log-thoughts: successfully logged to $LOG_FILE" >&2

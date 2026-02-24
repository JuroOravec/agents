#!/usr/bin/env bash
# Log agent chat responses to .cursor/logs/chats/chats-YYYY-MM-DD.jsonl
# Runs on afterAgentResponse. Truncates text to 100 chars.
# started_at is filled later by the dashboard server (matched from beforeSubmitPrompt logs).
#
# After changing this script or hooks.json: Reload Window (Cmd+Shift+P → "Reload Window") for Cursor to pick up changes.
set -e

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_CURSOR="$HOOK_DIR/.."
LOG_BASE="$PROJECT_CURSOR/logs/chats"
DATE_STR=$(date -u +"%Y-%m-%d")
LOG_FILE="$LOG_BASE/chats-$DATE_STR.jsonl"

mkdir -p "$LOG_BASE"

echo "log-chats: logging to $LOG_FILE" >&2

payload=$(cat)
text=$(echo "$payload" | jq -r '(.text // "") | if length > 100 then .[0:100] + "…" else . end')
conversation_id=$(echo "$payload" | jq -r '.conversation_id // ""')
generation_id=$(echo "$payload" | jq -r '.generation_id // ""')
model=$(echo "$payload" | jq -r '.model // ""')
cursor_version=$(echo "$payload" | jq -r '.cursor_version // ""')

finished_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

jq -n -c \
  --arg finished_at "$finished_at" \
  --arg text "$text" \
  --arg conversation_id "$conversation_id" \
  --arg generation_id "$generation_id" \
  --arg model "$model" \
  --arg cursor_version "$cursor_version" \
  '{
    finished_at: $finished_at,
    event: "agentResponse",
    text: $text,
    conversation_id: $conversation_id,
    generation_id: $generation_id,
    model: $model,
    cursor_version: $cursor_version
  }' >> "$LOG_FILE"

echo "log-chats: successfully logged to $LOG_FILE" >&2

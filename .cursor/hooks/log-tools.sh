#!/usr/bin/env bash
# Log tool invocations to .cursor/logs/tools/tools-YYYY-MM-DD.jsonl
# Runs on postToolUse and postToolUseFailure. Same log file for both.
#
# After changing this script or hooks.json: Reload Window (Cmd+Shift+P → "Reload Window") for Cursor to pick up changes.
set -e

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_CURSOR="$HOOK_DIR/.."
LOG_BASE="$PROJECT_CURSOR/logs/tools"
DATE_STR=$(date -u +"%Y-%m-%d")
LOG_FILE="$LOG_BASE/tools-$DATE_STR.jsonl"

mkdir -p "$LOG_BASE"

echo "log-tools: logging to $LOG_FILE" >&2

payload=$(cat)
hook_event=$(echo "$payload" | jq -r '.hook_event_name // ""')
tool_name=$(echo "$payload" | jq -r '.tool_name // .name // ""')
tool_input=$(echo "$payload" | jq -c '.tool_input // .input // {}')
tool_use_id=$(echo "$payload" | jq -r '.tool_use_id // .id // ""')
cwd=$(echo "$payload" | jq -r '.cwd // ""')
duration=$(echo "$payload" | jq -r '.duration // 0 | tonumber')
model=$(echo "$payload" | jq -r '.model // ""')
error_message=$(echo "$payload" | jq -r '.error_message // .error // ""')
failure_type=$(echo "$payload" | jq -r '.failure_type // ""')
is_interrupt=$(echo "$payload" | jq -r '.is_interrupt // false')

finished_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
start_secs=$(($(date +%s) - duration / 1000))
started_at=$(date -u -r "$start_secs" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "@$start_secs" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "$finished_at")

if [[ "$hook_event" == "postToolUseFailure" ]]; then
  event="toolUseFailure"
  jq -n -c \
    --arg finished_at "$finished_at" \
    --arg tool_name "$tool_name" \
    --argjson tool_input "$tool_input" \
    --arg tool_use_id "$tool_use_id" \
    --arg cwd "$cwd" \
    --argjson duration "$duration" \
    --arg error_message "$error_message" \
    --arg failure_type "$failure_type" \
    --argjson is_interrupt "$is_interrupt" \
    --arg started_at "$started_at" \
    '{
      finished_at: $finished_at,
      event: "toolUseFailure",
      tool_name: $tool_name,
      tool_input: $tool_input,
      tool_use_id: $tool_use_id,
      cwd: $cwd,
      duration: $duration,
      error_message: $error_message,
      failure_type: $failure_type,
      is_interrupt: $is_interrupt,
      started_at: $started_at
    }' >> "$LOG_FILE"
else
  event="toolUse"
  jq -n -c \
    --arg finished_at "$finished_at" \
    --arg tool_name "$tool_name" \
    --argjson tool_input "$tool_input" \
    --arg tool_use_id "$tool_use_id" \
    --arg cwd "$cwd" \
    --argjson duration "$duration" \
    --arg model "$model" \
    --arg started_at "$started_at" \
    '{
      finished_at: $finished_at,
      event: "toolUse",
      tool_name: $tool_name,
      tool_input: $tool_input,
      tool_use_id: $tool_use_id,
      cwd: $cwd,
      duration: $duration,
      model: $model,
      started_at: $started_at
    }' >> "$LOG_FILE"
fi

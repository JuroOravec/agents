#!/usr/bin/env bash
# Capture prompt hook: logs (1) last agent summary + context, (2) user message word-for-word.
# Runs on beforeSubmitPrompt. Writes to .cursor/logs/prompts-YYYY-MM-DD.jsonl (rotated by date)
#
# After changing this script or hooks.json: Reload Window (Cmd+Shift+P → "Reload Window") for Cursor to pick up changes.
set -e

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_CURSOR="$HOOK_DIR/.."
LOG_DIR="$PROJECT_CURSOR/logs"
DATE_STR=$(date -u +"%Y-%m-%d")
LOG_FILE="$LOG_DIR/prompts-$DATE_STR.jsonl"
SUMMARY_FILE="$LOG_DIR/last-agent-summary.txt"

mkdir -p "$LOG_DIR"

# Debug: visible in Output → Hooks (stderr); stdout is reserved for Cursor
echo "capture-prompts: logging to $LOG_FILE" >&2

# Read JSON payload from stdin
payload=$(cat)

# Parse with jq (or fallback: log raw if jq missing)
prompt=$(echo "$payload" | jq -r '.prompt // ""')
conversation_id=$(echo "$payload" | jq -r '.conversation_id // ""')
generation_id=$(echo "$payload" | jq -r '.generation_id // ""')
hook_event=$(echo "$payload" | jq -r '.hook_event_name // ""')
workspace_roots=$(echo "$payload" | jq -c '.workspace_roots // []')
attachments=$(echo "$payload" | jq -c '.attachments // []')

# 1) Last agent summary + context
last_agent_summary="(none)"
if [[ -f "$SUMMARY_FILE" ]]; then
  last_agent_summary=$(cat "$SUMMARY_FILE")
  # Clear for next turn so we don't reuse old summary
  : > "$SUMMARY_FILE"
fi

# Build context string from attachments
context_parts=()
if [[ "$workspace_roots" != "[]" && "$workspace_roots" != "null" ]]; then
  context_parts+=("workspace: $workspace_roots")
fi
if [[ "$attachments" != "[]" && "$attachments" != "null" ]]; then
  context_parts+=("attachments: $attachments")
fi
context="${context_parts[*]:-(none)}"

# 2) User message word-for-word (already in $prompt)

# Log as single JSONL line (compact, one object per line)
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
jq -n -c \
  --arg ts "$timestamp" \
  --arg cid "$conversation_id" \
  --arg gid "$generation_id" \
  --arg event "$hook_event" \
  --arg summary "$last_agent_summary" \
  --arg ctx "$context" \
  --arg msg "$prompt" \
  '{ts: $ts, conversation_id: $cid, generation_id: $gid, hook: $event, last_agent_summary: $summary, context: $ctx, user_message: $msg}' >> "$LOG_FILE"

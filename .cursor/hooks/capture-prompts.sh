#!/usr/bin/env bash
# Capture prompt hook: logs (1) last 5 lines of transcript (prior turn), (2) user message word-for-word.
# Runs on beforeSubmitPrompt. Writes to .cursor/logs/prompts/prompts-YYYY-MM-DD.jsonl (rotated by date)
#
# Transcript: ~/.cursor/projects/{project-id}/agent-transcripts/{conversation_id}.txt
# project-id = workspace root with / replaced by - (e.g. /Users/me/repos/x -> Users-me-repos-x)
#
# After changing this script or hooks.json: Reload Window (Cmd+Shift+P → "Reload Window") for Cursor to pick up changes.
set -e

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_CURSOR="$HOOK_DIR/.."
LOG_DIR="$PROJECT_CURSOR/logs/prompts"
DATE_STR=$(date -u +"%Y-%m-%d")
LOG_FILE="$LOG_DIR/prompts-$DATE_STR.jsonl"

mkdir -p "$LOG_DIR"

# Debug: visible in Output → Hooks (stderr); stdout is reserved for Cursor
echo "capture-prompts: logging to $LOG_FILE" >&2

# Read JSON payload from stdin
payload=$(cat)

# Parse with jq
prompt=$(echo "$payload" | jq -r '.prompt // ""')
conversation_id=$(echo "$payload" | jq -r '.conversation_id // ""')
generation_id=$(echo "$payload" | jq -r '.generation_id // ""')
model=$(echo "$payload" | jq -r '.model // ""')
cursor_version=$(echo "$payload" | jq -r '.cursor_version // ""')
hook_event=$(echo "$payload" | jq -r '.hook_event_name // ""')
workspace_roots=$(echo "$payload" | jq -c '.workspace_roots // []')
attachments=$(echo "$payload" | jq -c '.attachments // []')

# Last 5 lines of transcript (prior turn context) — or "(none)" if unavailable
# Cursor stores transcripts in ~/.cursor/projects/{project-id}/agent-transcripts/{conversation_id}.txt
# With multi-root workspaces, project-id may not match the first workspace root (e.g. *-code-workspace), so we search all projects.
last_turn_preview="(none)"
if [[ -n "$conversation_id" ]]; then
  projects_dir="${HOME}/.cursor/projects"
  transcript_file=""
  if [[ -d "$projects_dir" ]]; then
    for proj in "$projects_dir"/*/; do
      candidate="${proj}agent-transcripts/${conversation_id}.txt"
      if [[ -f "$candidate" ]]; then
        transcript_file="$candidate"
        break
      fi
    done
  fi
  if [[ -n "$transcript_file" && -f "$transcript_file" ]]; then
    last_turn_preview=$(tail -5 "$transcript_file" 2>/dev/null | tr '\n' ' ' | sed 's/ *$//') || last_turn_preview="(none)"
    [[ -z "$last_turn_preview" ]] && last_turn_preview="(none)"
  fi
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

# Log as single JSONL line (compact, one object per line)
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
jq -n -c \
  --arg ts "$timestamp" \
  --arg cid "$conversation_id" \
  --arg gid "$generation_id" \
  --arg model "$model" \
  --arg cursor_version "$cursor_version" \
  --arg event "$hook_event" \
  --arg preview "$last_turn_preview" \
  --arg ctx "$context" \
  --arg msg "$prompt" \
  '{ts: $ts, conversation_id: $cid, generation_id: $gid, model: $model, cursor_version: $cursor_version, hook: $event, last_turn_preview: $preview, context: $ctx, user_message: $msg}' >> "$LOG_FILE"

# Debug: visible in Output → Hooks (stderr); stdout is reserved for Cursor
echo "capture-prompts: successfully logged to $LOG_FILE" >&2

#!/usr/bin/env bash
# session-init: Injects session_id (conversation_id) into agent context at session start.
# Agents use session_id when calling skill-eval start. Required for meta-evaluation
# skill-adherence tracking (see docs/design-decisions/meta-skill-evaluation/).
#
# Cursor sessionStart hook receives conversation_id; we inject it as additional_context
# so the agent sees it and can pass it to scripts/skill-eval.sh start {session_id} {skill_name}.
#
# After changing this script or hooks.json: Reload Window (Cmd+Shift+P → "Reload Window").
set -e

# Read JSON payload from stdin
payload=$(cat)

# conversation_id is Cursor's stable ID for the chat session — we use it as session_id
session_id=$(echo "$payload" | jq -r '.conversation_id // ""')

if [[ -z "$session_id" ]]; then
  echo "session-init: no conversation_id in payload, skipping injection" >&2
  # Still continue — session proceeds without session_id (agent won't be able to use skill-eval)
  echo '{"continue": true}'
  exit 0
fi

# Inject session_id into agent context. Format: clear instruction the agent can parse and pass to skill-eval.
# Cursor sessionStart supports additional_context to add text to the conversation.
additional_context="**Session ID (for skill-eval):** \`$session_id\`

When following phased skills (e.g. act-repo-issue-create), run \`skill-eval start $session_id <skill_name>\` at workflow start. Preserve this session_id and the returned skill_id in context for \`skill-eval complete\` calls."

# Output JSON for Cursor to consume. continue: true allows session to proceed.
jq -n \
  --arg session_id "$session_id" \
  --arg additional_context "$additional_context" \
  '{continue: true, additional_context: $additional_context}'

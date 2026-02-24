#!/usr/bin/env bash
# session-init: Injects conversation_id into agent context at session start.
# Agents use conversation_id when calling skill-eval start. Required for meta-evaluation
# skill-adherence tracking (see docs/design-decisions/meta-skill-evaluation/).
#
# Cursor sessionStart hook receives conversation_id; we inject it as additional_context
# so the agent sees it and can pass it to scripts/skill-eval.sh start {conversation_id} {skill_name}.
#
# After changing this script or hooks.json: Reload Window (Cmd+Shift+P → "Reload Window").
set -e

# Read JSON payload from stdin
payload=$(cat)

# conversation_id is Cursor's stable ID for the chat session
conversation_id=$(echo "$payload" | jq -r '.conversation_id // ""')

if [[ -z "$conversation_id" ]]; then
  echo "session-init: no conversation_id in payload, skipping injection" >&2
  # Still continue — session proceeds without conversation_id (agent won't be able to use skill-eval)
  echo '{"continue": true}'
  exit 0
fi

# Inject conversation_id into agent context. Format: clear instruction the agent can parse and pass to skill-eval.
# Cursor sessionStart supports additional_context to add text to the conversation.
additional_context="**Conversation ID (for skill-eval):** \`$conversation_id\`

When following phased skills (e.g. act-repo-issue-create), run \`skill-eval start $conversation_id <skill_name>\` at workflow start. Preserve this conversation_id and the returned skill_id in context for \`skill-eval complete\` calls."

# Output JSON for Cursor to consume. continue: true allows session to proceed.
jq -n \
  --arg additional_context "$additional_context" \
  '{continue: true, additional_context: $additional_context}'

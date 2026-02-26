# Cursor Hooks

## session-init (sessionStart)

Injects `conversation_id` into the agent's context at session start. Agents use this when calling `skill-eval start` for meta-evaluation skill-adherence tracking.

- **Design:** [session-id-injection.md](../../specs/meta-skill-evaluation/session-id-injection.md)
- **Script:** `.cursor/hooks/session-init.sh`

## capture-prompts (beforeSubmitPrompt)

Logs each user message to `.cursor/logs/prompts/prompts-YYYY-MM-DD.jsonl` (one file per day) with:

1. **Last turn preview** — Last 5 lines of the agent transcript (`~/.cursor/projects/{project-id}/agent-transcripts/{conversation_id}.txt`) for prior-turn context, or `(none)` if unavailable.
2. **Context** — Attachments and workspace roots.
3. **User message** — Word-for-word.

### Requirements

- `jq` must be installed (`brew install jq` on macOS).
- The hook script must be executable: `chmod +x .cursor/hooks/capture-prompts.sh`.

### Log format (JSONL)

Each line is a JSON object:

```json
{
  "ts": "2025-02-23T14:30:00Z",
  "conversation_id": "uuid",
  "generation_id": "uuid",
  "hook": "beforeSubmitPrompt",
  "last_turn_preview": "Last 5 lines of transcript...",
  "context": "workspace: [...] attachments: [...]",
  "user_message": "The user's message word-for-word"
}
```

### Log rotation

Logs rotate by date: one file per day (`prompts-2025-02-23.jsonl`). Older files are kept; prune manually if desired. View in the dashboard at `/prompts`.

### After making changes

**Reload Window** after editing `hooks.json` or any hook script — Cursor reads hooks only at startup. Use **Cmd+Shift+P → "Developer: Reload Window"**.

### Debugging

The script writes a brief line to stderr on each run (`capture-prompts: logging to …`). Check **Output → Hooks** in Cursor for hook execution and errors.

## log-agents (subagentStop)

Logs subagent runs to `.cursor/logs/agents/agents-YYYY-MM-DD.jsonl`. Extracts `subagent_type`, `status`, `duration`; computes `finished_at` (now UTC) and `started_at` (finished_at - duration).

## log-tools (postToolUse, postToolUseFailure)

Logs tool invocations to `.cursor/logs/tools/tools-YYYY-MM-DD.jsonl`. Same log file for both success and failure events. Distinguishes via `hook_event_name` in the payload.

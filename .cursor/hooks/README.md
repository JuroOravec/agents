# Cursor Hooks

## capture-prompts (beforeSubmitPrompt)

Logs each user message to `.cursor/logs/prompts-YYYY-MM-DD.jsonl` (one file per day) with:

1. **Last agent summary + context** — 1–2 sentence summary of the agent’s previous response (from `.cursor/logs/last-agent-summary.txt`, written by the agent per always-apply-skills rule), plus attachments and workspace.
2. **User message** — Word-for-word.

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
  "last_agent_summary": "[timestamp] Summary of prior agent response.",
  "context": "workspace: [...] attachments: [...]",
  "user_message": "The user's message word-for-word"
}
```

### Log rotation

Logs rotate by date: one file per day (`prompts-2025-02-23.jsonl`). Older files are kept; prune manually if desired.

### After making changes

**Reload Window** after editing `hooks.json` or any hook script — Cursor reads hooks only at startup. Use **Cmd+Shift+P → "Developer: Reload Window"**.

### Debugging

The script writes a brief line to stderr on each run (`capture-prompts: logging to …`). Check **Output → Hooks** in Cursor for hook execution and errors.

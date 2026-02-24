# Conversation ID Injection for skill-eval

## Summary

Agents running phased skills (e.g. `act-repo-issue-create`) must pass `conversation_id` to `skill-eval start`. The conversation_id must live **in the agent's context window**—not in a file (file-based approach breaks with parallel agents).

This document describes how `conversation_id` reaches the agent and the fallback if the primary mechanism is unavailable.

---

## Primary: sessionStart hook

**Cursor exposes a `sessionStart` hook** that fires when a new Agent Chat session begins. It receives `conversation_id` (Cursor's stable identifier for the chat) and can return `additional_context` to inject text into the conversation—text the agent will see.

### Implementation

| File | Purpose |
|------|---------|
| `.cursor/hooks.json` | Declares `sessionStart` → `.cursor/hooks/session-init.sh` |
| `.cursor/hooks/session-init.sh` | Reads `conversation_id` from stdin, outputs `{ "continue": true, "additional_context": "..." }` |

### Flow

1. User opens a new Agent Chat (Cmd+K or Composer).
2. Cursor fires `sessionStart` before the first message.
3. `session-init.sh` receives JSON: `{ "conversation_id": "<uuid>", ... }`.
4. Script outputs: `{ "continue": true, "additional_context": "**Conversation ID:** \`<uuid>\`\n\nWhen following phased skills..." }`.
5. Cursor injects that text into the agent's context.
6. Agent sees `conversation_id` and can pass it to `skill-eval start {conversation_id} {skill_name}`.

### Cursor docs

- [Hooks](https://cursor.com/docs/agent/hooks): Lists `sessionStart` / `sessionEnd` under "Session lifecycle management".
- [Third Party Hooks](https://cursor.com/docs/agent/third-party-hooks): Maps Claude Code `SessionStart` → Cursor `sessionStart`.
- Forum: ["The sessionStart hook can inject additional_context into a conversation"](https://forum.cursor.com/t/hooks-allow-beforesubmitprompt-hook-to-inject-additional-context/150707).

### Verification

1. Reload Window (Cmd+Shift+P → "Developer: Reload Window") after changing hooks.
2. Open a new Agent Chat.
3. Check **Output → Hooks** for `session-init` execution and any errors.
4. In the same chat, ask the agent to run `skill-eval start`—it should have `conversation_id` in context.

---

## Fallback: beforeSubmitPrompt + conversation_id

If `sessionStart` or `additional_context` is not supported in your Cursor version:

### Option A: beforeSubmitPrompt prompt prepending

Some Cursor versions let `beforeSubmitPrompt` **modify the prompt** (output the transformed prompt via stdout). In that case, a hook could prepend:

```
[conversation_id: <conversation_id>]

<original user prompt>
```

**Limitation:** The forum states that `beforeSubmitPrompt` "cannot inject context—only block submission." Prompt modification may be version-dependent; verify in Output → Hooks.

### Option B: Rule/skill instruction to read from capture-prompts

The existing `capture-prompts` hook logs each prompt with `conversation_id` to `.cursor/logs/prompts/prompts-YYYY-MM-DD.jsonl`. A rule could instruct the agent: "Before using skill-eval, run `jq -r '.[-1].conversation_id' .cursor/logs/prompts/prompts-*.jsonl` to get conversation_id."

**Limitations:** Brittle (depends on log format, file presence). Does not work well with parallel sessions (log interleaving). **Not recommended**—use only as last resort.

### Option C: Agent generates its own conversation_id

If no hook can inject context, the agent could generate a UUID at workflow start and pass it to `skill-eval start`. The session would not correlate with Cursor's `conversation_id` (no transcript correlation), but skill-adherence data would still be collected per invocation.

---

## Relation to other work

| Item | Dependency |
|------|------------|
| skill-eval CLI | Implemented (`scripts/skill-eval.sh`) |
| sessionStart hook | This implementation |
| [Issue #11](https://github.com/JuroOravec/agents/issues/11) Rule/skill instruction | Depends on #10; tells agents to pass conversation_id, preserve skill_id, call complete |
| Phase format enforcement | [#9] Required for reliable phase numbering |

---

## Open questions

1. **Exact `additional_context` schema:** Cursor's docs do not document the sessionStart output schema in detail. We assume `{ "continue": boolean, "additional_context": string }`. If your Cursor version rejects this, check Output → Hooks for error messages and adjust.
2. **sessionStart timing:** Fires "before the user types their first message." If the user sends the first message very quickly, the order is: sessionStart → beforeSubmitPrompt → model. conversation_id is available from the first turn.

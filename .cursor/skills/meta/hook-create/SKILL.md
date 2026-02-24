---
name: meta-hook-create
description: Create or modify Cursor lifecycle hooks. Use when adding a beforeSubmitPrompt, beforeShellExecution, beforeReadFile, stop, or other hook; or when the user wants to intercept Cursor agent actions.
---

# Cursor Hooks

Create and configure Cursor lifecycle hooks that run scripts when the agent takes certain actions (e.g. before submitting a prompt, before reading a file, when a task stops).

## When to use

Trigger this skill when:

- Adding a hook to capture prompts, audit file edits, or run automations.
- The user wants to "hook into" Cursor's agent lifecycle.
- Creating a new `.cursor/hooks.json` or modifying existing hooks.

## Reference: capture-prompts example

This project has a working example: the **capture-prompts** hook logs each user message with last turn preview (from transcript) and context. Use it as a template.

| File | Purpose |
| --- | --- |
| `.cursor/hooks.json` | Declares which commands run for each hook event |
| `.cursor/hooks/capture-prompts.sh` | Script that receives JSON on stdin, logs to `.cursor/logs/` |
| `.cursor/hooks/README.md` | Hooks documentation |

See [capture-prompts.sh](../../hooks/capture-prompts.sh) and [hooks/README.md](../../hooks/README.md) for the full implementation.

### Hook events (Cursor 1.7+)

- `sessionStart` — When a new Agent Chat session begins. Payload: `conversation_id`, `generation_id`, `workspace_roots`, etc. Can return `additional_context` to inject text into the agent's context. See [session-id-injection.md](../../../docs/design-decisions/meta-skill-evaluation/session-id-injection.md).
- `beforeSubmitPrompt` — When user sends a message, before it reaches the model. Payload: `prompt`, `conversation_id`, `generation_id`, `attachments`, `workspace_roots`.
- `beforeReadFile` — Before the agent reads a file. Can filter/redact content.
- `beforeShellExecution` — Before running a shell command. Can allow/deny.
- `beforeMCPExecution` — Before an MCP tool call.
- `afterFileEdit` — After the agent edits a file. Payload: `file_path`, `edits` (old_string, new_string).
- `stop` — When the task completes. Payload: `status` (completed, aborted, error).

### Config locations

Hooks are merged from (in order): user `~/.cursor/hooks.json`, enterprise `/etc/cursor/hooks.json`, project `.cursor/hooks.json`.

## Workflow

**Format:** All skills MUST use `### Phase N: Title` for each workflow step. Enforced by validation script in CI.

**Skill-eval (meta-evaluation):** From the project root, run `./scripts/skill-eval.sh start {conversation_id} meta-hook-create` at workflow start (conversation_id is injected at session start—look for "Conversation ID (for skill-eval)" in context). Capture the printed `skill_id` from the terminal output. Preserve both `conversation_id` and `skill_id` for the duration—if context gets summarized, ensure these IDs are retained. After each phase (or when skipping a phase), run `./scripts/skill-eval.sh complete {skill_id} {phase_no}` or `./scripts/skill-eval.sh complete {skill_id} {phase_no} --skipped` from the project root.

Create todo tasks for each phase before proceeding.

### Phase 0: Research

Look up best practices and state-of-the-art for Cursor hooks and lifecycle interception: Cursor docs, community examples, similar tooling (VS Code hooks, editor extensions). Avoid assumptions about payload shapes or event ordering — verify against current docs.

### Phase 1: Add hooks.json

Create or edit `.cursor/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [{ "command": ".cursor/hooks/your-script.sh" }]
  }
}
```

**Command path:** Use `.cursor/hooks/script.sh` (relative to workspace root). Avoid `hooks/script.sh` — Cursor's cwd may differ and it can fail with "no such file or directory".

### Phase 2: Create the hook script

1. Create `.cursor/hooks/your-script.sh` (or `.ts`, `.js`).
2. Make it executable: `chmod +x .cursor/hooks/your-script.sh`.
3. The script receives JSON on stdin. Parse with `jq` (shell) or `JSON.parse` (Node).

Example (shell):

```bash
#!/usr/bin/env bash
payload=$(cat)
prompt=$(echo "$payload" | jq -r '.prompt // ""')
# ... your logic
```

### Phase 3: Reload Window

**Cursor only loads hooks at startup.** After any change to `hooks.json` or a hook script:

- **Cmd+Shift+P** → **"Developer: Reload Window"**

Document this in your hook README so users (and future you) know to reload.

### Phase 4: Debug

- Check **Output → Hooks** in Cursor for execution logs and stderr.
- Use `echo "debug message" >&2` — stdout is reserved for Cursor; stderr appears in the Hooks panel.

## Verification

- [ ] Best practices and docs were consulted for payload shapes and event behavior.
- [ ] `hooks.json` exists and lists the correct command path.
- [ ] Hook script is executable.
- [ ] Window was reloaded after changes.
- [ ] Output → Hooks shows the hook running (or errors).
- [ ] `.cursor/logs/` or output location is in `.gitignore` if logs contain sensitive data.

## Out of scope

- Agent rules and skills — see `meta-skill-create`, `meta-agent-create`.
- MCP servers — separate from hooks; hooks can run before MCP calls via `beforeMCPExecution`.

---
description: Core skill activation rules that apply to every interaction.
globs:
alwaysApply: true
---

# Always-Active Skills

## Reviewer Subagent (before concluding substantive work)

Before presenting completed work to the user, run the reviewer subagent to catch incomplete output, non-holistic approach, and glaring issues.

**When:** You have just completed substantive implementation work — code changes, multi-step skills (e.g. `act-dev--scraper-write`), or any non-trivial development task.

**How:** Read `.cursor/skills/act-dev-reviewer/SKILL.md` and invoke the reviewer via `mcp_task` (subagent_type: generalPurpose) with the reviewer prompt. When useful, attach paths to changed files so the reviewer can verify against the code. Wait for feedback, address any issues found, then present to the user.

**Skip:** Trivial edits (typos, single-line tweaks), pure Q&A, or when the user explicitly asked to skip review.

Note: If you followed `act-dev`, Phase 8b already includes this step.

## Prompt Capture (end of each response)

At the end of each substantive response, write a 1–2 sentence summary of what you said (and key context) to `.cursor/logs/last-agent-summary.txt`. Overwrite the file; use one line. Format: `[ISO timestamp] Summary text.` Example: `[2025-02-23T14:30:00Z] Explained the beforeSubmitPrompt hook and set up capture-prompts.sh; user wanted prompt logging.`

This handoff is read by the `beforeSubmitPrompt` hook when the user sends the next message, so the log can pair "last agent summary + context" with "user message word-for-word".

**Reminder:** If you skip this step, the next prompt log will show `(none)` for last_agent_summary; the user's message is still captured.

**Skip:** Trivial replies (acknowledgments, single-word answers), or when the response was empty.

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

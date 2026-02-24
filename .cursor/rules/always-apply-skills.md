---
description: Core skill activation rules that apply to every interaction.
globs:
alwaysApply: true
---

# Always-Active Skills

## Reviewer Subagent (before concluding substantive work)

Before presenting completed work to the user, run the reviewer subagent to catch incomplete output, non-holistic approach, and glaring issues.

**When:** You have just completed substantive implementation work — code changes, multi-step skills (e.g. `act-dev--scraper-write`), or any non-trivial development task.

**How:** Follow the `act-dev-review` skill.

**Skip:** Trivial edits (typos, single-line tweaks), pure Q&A, or when the user explicitly asked to skip review.

Note: If you followed act-dev, Phase 8b already includes this step.

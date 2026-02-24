# Agent Definitions

Custom agent definitions for Cursor. These can power slash commands (e.g. `/reviewer`, `/pm`) when Cursor supports local agent files.

## pm

Project manager for capture, triage, and prioritization. Helps with idea overload: capture to INBOX, triage when ready, promote to GitHub only when asked.

**Invocation:**
- **Manual:** "capture this", "triage my backlog", "what's next?", "wrap up", "I'm lost"
- **Content:** See `pm.md` for agent persona; see `.cursor/skills/act/pm/SKILL.md` for full workflow
- **Artifact:** `INBOX.md` at workspace root (local-first, then GitHub)

## reviewer

Adversarial reviewer that checks completed work for incomplete output, non-holistic approach, glaring issues, and skill discovery (meta-discovery).

**Invocation:**
- **Automatic:** Runs as Phase 8b in the `act-dev` workflow, and via the always-apply rule for substantive work from other skills.
- **Manual:** If Cursor exposes slash commands from `.cursor/agents`, use `/reviewer`. Otherwise, the main agent invokes it via `mcp_task` with the prompt from `act-dev-reviewer` skill.
- **Content:** See `reviewer.md` for the agent instructions; see `.cursor/skills/act/dev-reviewer/SKILL.md` for the full reviewer prompt template and invocation details.

## architect

Designs and breaks down large work into actionable pieces. Creates design docs, GitHub issues, and hands off to PM for prioritization. Operates at arch level (1–2 layers above dev): composition, data flows, and system boundaries — not implementation.

**Invocation:**
- **Manual:** "architect", "design and break down", "how would we implement", "break this into issues", "hand this to architect"
- **Content:** See `architect.md` for agent persona
- **Skills:** `act-architect` (direct breakdown); `act-arch-solution-create` (when expert produced multiple solutions — narrow, deep-dive, iterate, then create issues)
- **Artifact:** `{project}/docs/design-decisions/{topic}/` (one dir per topic; README.md = main design doc; project = repo the task relates to)

## worker

Executes development work from a pool of GitHub issues. Takes one at a time, implements via act-dev, closes the issue when done. Used for parallel execution after architect/PM handoff.

**Invocation:**
- **Manual:** "worker", "implement from pool", "take issues #5 #6 #7", "workers go"
- **Content:** See `worker.md` for agent persona; see `.cursor/skills/act/worker/SKILL.md` for full workflow
- **Flow:** Architect creates issues → PM prioritizes → Workers take from pool, implement, close when done

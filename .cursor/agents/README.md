# Agent Definitions

Custom agent definitions for Cursor. These can power slash commands (e.g. `/reviewer`, `/pm`) when Cursor supports local agent files.

## pm

Project manager for capture, triage, and prioritization. Helps with idea overload: capture to INBOX, triage when ready, promote to GitHub only when asked.

**Invocation:**
- **Manual:** "capture this", "triage my backlog", "what's next?", "wrap up", "I'm lost"
- **Content:** See `pm.md` for agent persona; see `.cursor/skills/act-pm/SKILL.md` for full workflow
- **Artifact:** `INBOX.md` at workspace root (local-first, then GitHub)

## reviewer

Adversarial reviewer that checks completed work for incomplete output, non-holistic approach, glaring issues, and skill discovery (meta-discovery).

**Invocation:**
- **Automatic:** Runs as Phase 8b in the `act-dev` workflow, and via the always-apply rule for substantive work from other skills.
- **Manual:** If Cursor exposes slash commands from `.cursor/agents`, use `/reviewer`. Otherwise, the main agent invokes it via `mcp_task` with the prompt from `act-dev-reviewer` skill.
- **Content:** See `reviewer.md` for the agent instructions; see `.cursor/skills/act-dev-reviewer/SKILL.md` for the full reviewer prompt template and invocation details.

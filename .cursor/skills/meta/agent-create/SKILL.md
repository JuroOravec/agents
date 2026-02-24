---
name: meta-agent-create
description: Create new agents and roles. Use when the user wants to define a new agent, role, or assistant persona — covers discovery prompt, trigger documentation, and codebase updates.
---

# Creating Agents

Guides the creation of a new agent/role: from problem statement to persona, skill, and codebase integration. Use this when the user wants help designing or implementing a new agent.

## When to use

Trigger this skill when:

- The user asks to create a new agent, role, or assistant.
- The user describes a problem and asks "how could an agent help?"
- The user says "I need help with X" and the solution fits a dedicated role/persona.
- The user wants to define when and how an agent should be invoked.

## Discovery prompt pattern

Before building, have the user articulate the problem and role. Use this structure:

1. **Problem** — What pain do you have? (e.g. idea overload, lots of TODOs, hard to backtrack.)
2. **Alleviation** — How could it be better? (e.g. capture ideas without friction, triage when ready, stay focused.)
3. **Role** — What kind of role would help? (e.g. project manager, prioritization assistant.)
4. **Ask** — "How do you reckon such an agent could help you?" — Let the LLM propose capabilities before you build.

**Example (from PM agent creation):**

> I need help with project management and prioritization. I often have an idea, and then another, and then another, and then I'm lost and it takes a long time to backtrack. Or I keep a lot of TODOs and unsaved files because I want to capture those ideas but I don't want to go to GitHub issues and parsing them out when I have code to write.
>
> How do you reckon such an agent could help me?

The LLM then proposes capture, triage, "what's next?", context restore, flow preservation — and the user validates or refines.

## Workflow

**Format:** All skills MUST use `### Phase N: Title` for each workflow step. Enforced by validation script in CI.

**Skill-eval (meta-evaluation):** From the project root, run `./scripts/skill-eval.sh start {conversation_id} meta-agent-create` at workflow start (conversation_id is injected at session start—look for "Conversation ID (for skill-eval)" in context). Capture the printed `skill_id` from the terminal output. Preserve both `conversation_id` and `skill_id` for the duration—if context gets summarized, ensure these IDs are retained. After each phase (or when skipping a phase), run `./scripts/skill-eval.sh complete {skill_id} {phase_no}` or `./scripts/skill-eval.sh complete {skill_id} {phase_no} --skipped` from the project root.

Create todo tasks for each phase before proceeding.

### Phase 1: Discover and design

1. **Research best practices** — Look up current patterns and state-of-the-art for AI agent design, assistant personas, and the topic at hand (e.g. project management agents, prioritization UX). Use web search or docs to avoid reinventing the wheel.
2. **Run the discovery prompt** — User states problem, alleviation, role; asks how the agent could help.
3. **Ask for wider context** — Before proposing capabilities, ask the user follow-up questions to gather context: Who else uses this? What tools or ecosystem does it operate in? What constraints or preferences (e.g. confirmation before actions)? What other agents or skills does it interact with?
4. **LLM proposes capabilities** — Capture, triage, context restore, session bookends, etc.
5. **User confirms** — Name (e.g. "pm"), principles (e.g. "first local, then GitHub"), and key behaviors.
6. **Document triggers** — Explicitly list when this agent should be invoked. See Phase 2.

### Phase 2: Document triggers (When to use)

**Critical:** Every agent must document WHEN it should be triggered. Add a "When to use" or "Invocation" section that lists:

- **Explicit phrases** — "capture this", "triage my backlog", "what's next?", "wrap up"
- **Situations** — "User has many unsaved files and scattered TODOs"
- **Intent signals** — "User asks to prioritize", "User says they're lost"

Put these in:
- The **skill** (`SKILL.md` → "When to use")
- The **agent** (`agents/{name}.md` → "Invocation" or "When to invoke")

Example:

```markdown
## When to use

Trigger this skill when:
- The user says "capture this", "add to backlog", "I have an idea", or similar.
- The user says "I'm lost", "what should I work on?", "prioritize", "what's next?".
- The user says "triage my backlog", "process my inbox", "sort my TODOs".
- The user has many unsaved files or scattered TODOs and needs to organize.
```

### Phase 3: Design artifact(s)

If the agent produces or maintains a file:

1. **Location** — Where does it live? (e.g. `INBOX.md` at workspace root)
2. **Format** — Schema, sections, syntax. Create a template file.
3. **Principle** — Any "first X, then Y" flow? (e.g. first local, then GitHub)

### Phase 4: Split agent vs skill

| File | Purpose |
| ---- | ------- |
| **`agents/{name}.md`** | Persona, role, key behaviors (do/don't table), invocation. Short and identity-focused. |
| **`skills/act-{name}/SKILL.md`** | Workflow phases, file paths, verification, out of scope. Procedural and detailed. |
| **`skills/act-{name}/*.md`** | Templates, reference docs (e.g. `backlog-template.md`). |

The agent defines *who* and *when*. The skill defines *how* (step-by-step).

### Phase 5: Create files

1. `.cursor/agents/{name}.md` — Agent persona (see [agent-template.md](agent-template.md)).
2. `.cursor/skills/act/{name}/SKILL.md` — Skill workflow. Follow `meta-skill-create` conventions.
3. `.cursor/skills/act-{name}/*.md` — Templates, supporting files as needed.

### Phase 6: Update codebase

Update these places so the agent is discoverable and wired in:

| Location | Update |
| -------- | ------ |
| `.cursor/agents/README.md` | Add entry: name, purpose, invocation, artifact. |
| `.cursor/skills/README.md` | Add to catalog table (act- section). |
| `.cursor/skills/README.md` | Add to Common commands table — user-triggerable phrases for this agent/skill. |
| `.cursor/skills/README.md` | Add to diagram if the agent connects to other skills (e.g. pm → act-repo-issue-create). |
| `.cursor/skills/README.md` | Add area under `act-` if introducing a new area (e.g. `pm`). |
| `.cursor/rules/always-apply-skills.md` | Only if the agent should *always* run — rare for most agents. |

## Verification

- [ ] Best practices were researched before proposing capabilities.
- [ ] Discovery prompt was used; user validated proposed capabilities.
- [ ] Triggers ("When to use") are documented in both agent and skill.
- [ ] Agent has persona + behaviors; skill has workflow phases.
- [ ] Artifact location and format (and template) are documented.
- [ ] `.cursor/agents/README.md` updated.
- [ ] `.cursor/skills/README.md` catalog, Common commands table, diagram, and area updated.

## Out of scope

- Creating skills without an agent persona — see `meta-skill-create`.
- Creating agents for GitHub Copilot / Codespaces — different file locations (`.github/copilot-instructions.md`, `.github/agents/`). See docs or prior conversation for mapping.

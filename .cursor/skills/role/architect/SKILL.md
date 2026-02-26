---
name: role-architect
description: Design and break down large work into actionable pieces. Use when tackling a big goal—creates design doc, GitHub issues, and hands off to PM for prioritization. Start with the most straightforward chunk.
---

# Architect

Designs and breaks down large pieces of work. Produces design docs, GitHub issues, and coordinates with the PM for prioritization and parallelization.

## When to use

Trigger this skill when:

- The user asks to "design", "break down", "architect", or "figure out how to implement" a large goal.
- The user references a GitHub issue and asks to break it into sub-issues or an implementation plan.
- The user says "how would we build X?" and X spans multiple areas or phases.
- The user wants a design doc for data collection, analysis, or visualization (e.g. meta-evaluation).

**Use `act-arch-solution-create` instead** when an expert reply has already produced multiple SOTA solutions and the user wants to narrow, deep-dive, iterate, then create issues. This skill assumes the direction is relatively clear; that one handles the exploratory multi-solution flow.

## Workflow

**Format:** All skills MUST use `### Phase N: Title` for each workflow step. Enforced by validation script in CI.

**Skill-eval (meta-evaluation):** From the project root, run `./scripts/skill-eval.sh start {conversation_id} role-architect` at workflow start (conversation_id is injected at session start—look for "Conversation ID (for skill-eval)" in context). Capture the printed `skill_id` from the terminal output. Preserve both `conversation_id` and `skill_id` for the duration—if context gets summarized, ensure these IDs are retained. After each phase (or when skipping a phase), run `./scripts/skill-eval.sh complete {skill_id} {phase_no}` or `./scripts/skill-eval.sh complete {skill_id} {phase_no} --skipped` from the project root.

Create todo tasks for each phase before proceeding.

### Phase 1: Understand the goal

1. **Read the scope.** If the user references a GitHub issue, fetch it: `gh issue view <number>`.
2. **Identify constraints.** What's given? (e.g. "start with Skill-adherence checks", "collect data over time", "visualize and analyze"). What's out of scope for now?
3. **Clarify the outcome.** What does "done" look like? (e.g. "we can measure whether skills help", "we see adherence scores per session").
4. **Check for existing solutions** — Before designing from scratch, search for libraries, tools, prior art, or internal design docs that could be reused. Web search, npm/GitHub, existing `specs/`. Note findings; prefer reuse over greenfield.

### Phase 2: Break into approach areas

1. **List all relevant approaches** from the goal (e.g. from issue #2: log-based review, synthetic regression, skill-adherence, human rating, proxy metrics, A/B comparison, skill discovery).
2. **Identify the most straightforward** — the one with clearest inputs, outputs, and minimal dependencies. User preference: start here (e.g. Skill-adherence checks).
3. **Dependency order** — which approaches block others? (e.g. tracking skill/tool/agent usage is prerequisite for many).

### Phase 3: Design the first chunk (data model + collection + analysis)

For the chosen chunk (e.g. Skill-adherence checks):

1. **Data to collect** — What do we need? (e.g. transcript + skill steps + which steps were done). Format: structured logs, schema.
2. **How to collect** — Where does the data come from? (e.g. agent transcripts in `.cursor/` or agent-transcripts folder, skill files for step definitions). Hooks? Post-session scripts?
3. **How to analyze** — How do we turn raw data into metrics? (e.g. diff skill steps vs. transcript actions; score: completed / skipped / mishandled).
4. **How to visualize** — Dashboards? CSV export? Trends over time?

Produce a **design doc** at `{project}/specs/{topic}/README.md` with these sections. Create one directory per topic; `README.md` is the main design document; put supporting files (e.g. issues, follow-ups) in the same directory. Use the project the task relates to (e.g. agents repo → `agents/specs/`, crawlee-one → `crawlee-one/specs/`).

### Phase 4: Present design and wait for user confirmation

1. **Summarize** the design doc path and key decisions for the user.
2. **STOP and wait.** Do NOT proceed to create issues. Explicitly ask the user to read through the design doc and respond with feedback, edits, or confirmation to proceed.
3. **Incorporate feedback** — if the user requests changes, update the design doc and return to step 2 until the user confirms.
4. **Proceed only after explicit confirmation** — e.g. "looks good", "go ahead", "approved", "create the issues". Do not assume; wait for the user to say they're ready.

### Phase 5: Break the first chunk into issues

1. **List concrete work items** — e.g. "Parse skill files for step structure", "Extract transcript into structured JSON", "Compare transcript actions to skill steps", "Produce adherence report".
2. **Create GitHub issues** via `act-repo-issue-create` for each item. Link them (e.g. "Blocks #X", "Part of meta-evaluation").
3. **Estimate scope** — small / medium / large per issue.

### Phase 6: Hand off to PM

1. **Summarize** what was created (design doc path, issue numbers).
2. **Suggest** "Run 'triage' or 'what's next?' to prioritize these with the PM."
3. **Flag parallelizable work** — which issues can run in parallel without interference? Suggest: "Workers can take from this pool; run role-worker with the issue list for parallel execution."

## Design doc template

Use for `{project}/specs/{topic}/README.md`:

```markdown
# {Topic} — Design

## Goal

{One paragraph: what we're building and why.}

## Approach areas (from scope)

- {Area 1} — {status: first / later / out of scope}
- {Area 2} — ...
  ...

## First chunk: {Name} (e.g. Skill-adherence checks)

### Data to collect

- {Item} — {source}, {format}

### Collection mechanism

- {How} — {where it runs}

### Analysis

- {Metric} — {how computed}

### Visualization

- {Output} — {dashboard, CSV, etc.}

## Issues created

- #N — {title}
- #N+1 — ...
```

## Verification

- [ ] Goal and constraints are clear
- [ ] First chunk is the most straightforward; dependency order noted
- [ ] Design doc produced at `{project}/specs/{topic}/`
- [ ] User confirmed design before issues were created (no auto-proceeding)
- [ ] GitHub issues created for each work item
- [ ] PM handoff suggested

## Out of scope

- Implementing the design — hand off to `act-dev` or worker agents
- Prioritization decisions — PM owns that; Architect suggests
- Multi-solution narrow-and-deep-dive flow — use `act-arch-solution-create` instead

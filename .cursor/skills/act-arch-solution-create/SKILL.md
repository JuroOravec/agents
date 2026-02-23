---
name: act-arch-solution-create
description: Architect-led workflow when expert reply produced multiple solutions. Use when narrowing options, deep-diving, iterating with user, then creating tracked work packages via GitHub issues.
---

# Solution Create (Architect)

Architect-led workflow for turning an expert's multiple SOTA solutions into agreed-upon, prioritized work packages. The architect continues the discussion with the user, narrows and deep-dives into solutions, iterates until agreement, then creates GitHub issues with design docs and an umbrella ticket.

**Context:** A seemingly simple or ambiguous question (e.g. "how to test skills and agents on meta level") produced an expert reply exploring best practices and a range of potential solutions. The work is now handed off to the architect.

## When to use

Trigger this skill when:

- An expert (or prior agent) has produced multiple solution options for an ambiguous problem.
- The user wants to narrow down, understand trade-offs, and turn options into tracked work.
- The conversation flow is: question → expert reply with options → **hand off to architect**.
- The user says "hand this to architect", "let's narrow these down", "deep dive into these solutions", or similar after receiving multiple options.

## Scope: arch vs dev

**Arch** skills operate 1–2 layers above **dev**:

- **Dev:** Code-level — e.g. "implement a feature and add a new table in the existing db".
- **Arch:** Composition-level — e.g. "there is a task that will require new kind of data and new processes independent of existing ones"; "sales need a platform to aggregate intel on leads".

This skill is arch-level: it shapes *what* gets built and *how* solutions relate, not the implementation.

## Workflow

**Format:** All skills MUST use `### Phase N: Title` for each workflow step. Enforced by validation script in CI.

**Skill-eval (meta-evaluation):** From the project root, run `./scripts/skill-eval.sh start {session_id} act-arch-solution-create` at workflow start (session_id is injected at session start—look for "Session ID (for skill-eval)" in context). Capture the printed `skill_id` from the terminal output. Preserve both `session_id` and `skill_id` for the duration—if context gets summarized, ensure these IDs are retained. After each phase (or when skipping a phase), run `./scripts/skill-eval.sh complete {skill_id} {phase_no}` or `./scripts/skill-eval.sh complete {skill_id} {phase_no} --skipped` from the project root.

Create todo tasks for each phase before proceeding.

### Phase 1: Handoff and scope narrowing

1. **Take over from expert.** Summarize the problem and list all proposed solutions (from transcript, issue, or prior message).
2. **Check for existing solutions** — Before narrowing, search for libraries, tools, prior art, or internal design docs that could replace or simplify any proposed solution. Web search, npm/GitHub, existing `docs/design-decisions/`. Share findings with user; prefer reuse over greenfield.
3. **Present to user.** "Here are the solutions from the expert reply (and any existing solutions found). Which make sense for us?"
4. **Discuss with user.** Iterate: Which solutions align with our goals? Which are out of scope, redundant, or infeasible?
5. **Narrow the set.** Agree on which solutions to pursue (one or more). Document the rationale briefly.

**Output:** Short list of solutions to pursue, with reasons.

### Phase 2: Deep dive (iterative)

1. **For each solution the user wants to explore first**, produce a **research / discovery / design document**:
   - Goal and scope of this solution
   - Data, processes, and dependencies
   - How it fits with the rest of the system
   - Risks, trade-offs, alternatives considered
   - Suggested placement: `{project}/docs/design-decisions/{topic}/` — create one directory per topic; `README.md` is the main design doc; put supporting docs (e.g. `issues.md`, per-solution files) in the same directory. Use the project the task relates to (e.g. agents → `agents/docs/design-decisions/`, crawlee-one → `crawlee-one/docs/design-decisions/`).
2. **Iterate with user** on each doc until satisfied.
3. **For any selected solution not yet deep-dived**, produce the same kind of doc.
4. **Confirm with user** when all selected solutions have design docs.

**Output:** One design doc per selected solution, user-approved.

### Phase 3: Final review and confirm before creating work packages

1. **Present all design docs** to the user one last time.
2. **STOP and wait.** Do NOT proceed to Phase 4 (prioritization) or Phase 5 (create issues) until the user explicitly confirms. Give the user time to read through the docs.
3. **Incorporate feedback** — if the user requests changes, update the design docs and return to step 2.
4. **Proceed only after explicit confirmation** — e.g. "looks good", "go ahead", "create the issues". Do not assume readiness; wait for the user to say they're ready.

**Output:** Final set of design docs, user-approved. Do not create issues until user confirms.

### Phase 4: Prioritization

1. **Architect proposes** either:
   - **(a)** A prioritization of solutions (order, dependencies, quick wins vs. long-term), or
   - **(b)** A test harness / evaluation approach to figure out prioritization (e.g. benchmark, A/B, pilot).
   - Note: The test harness may *be* one of the selected solutions (e.g. "synthetic regression tests" as meta-evaluation approach).
2. **Iterate with user** until agreement and shared understanding.
3. **Document** the agreed prioritization or harness in a short summary.

**Output:** Prioritization plan or test-harness plan, user-approved.

### Phase 5: Create work packages

1. **Create GitHub issues** for each work package via `act-repo-issue-create`:
   - Include the **full deep-dive design** in the issue body (or link to `{project}/docs/design-decisions/{topic}/` if already committed).
   - Add acceptance criteria, dependencies, and scope estimate (small/medium/large).
2. **Create an umbrella issue** that:
   - Links all subtask issues
   - Contains a **summary of the overall discussion** (problem, solutions considered, what was selected, rationale, prioritization)
   - Serves as the single place to track the initiative
3. **Architect ensures** in the breakdown:
   - Low tech debt — no shortcuts that will haunt us later
   - High separation of concerns — clear boundaries between pieces
   - Safety — guardrails, validation, rollback paths where relevant

**Output:** One umbrella issue + N work-package issues, all linked.

### Phase 6: Hand off to PM

1. **Summarize** what was created (umbrella issue #, work-package issues).
2. **Suggest** "Run 'triage' or 'what's next?' to prioritize execution with the PM. Workers can take from this pool for parallel execution."
3. **Flag parallelizable work** where possible. Point to act-worker for pool-based implementation.

## Design doc template (per solution)

Use for each deep-dive at `{project}/docs/design-decisions/{topic}/README.md` (main design doc; other supporting files like `issues.md` in the same `{topic}/` directory):

```markdown
# {Solution name} — Design

## Goal
{What this solution achieves and why it matters.}

## Scope
- In scope: ...
- Out of scope: ...

## Data / processes / dependencies
- {What data, where it comes from, what processes touch it}
- {Dependencies on other solutions or systems}

## How it fits
{Relation to other selected solutions; integration points.}

## Risks and trade-offs
- {Risk} — {mitigation}
- {Trade-off} — {why we accept it}

## Alternatives considered
- {Alt} — {why not chosen}
```

## Verification

- [ ] All proposed solutions reviewed with user; narrowed set agreed
- [ ] Deep-dive design doc produced for each selected solution
- [ ] Final review completed; user approved docs
- [ ] Prioritization or test harness agreed with user
- [ ] Umbrella issue created with full discussion summary
- [ ] Work-package issues created with design docs in descriptions
- [ ] Tech debt, separation of concerns, and safety considered in breakdown

## Out of scope

- Implementing the solutions — hand off to `act-dev` or worker agents
- Ongoing prioritization — PM owns that after handoff
- Single-solution, well-scoped goals — use `act-architect` instead (direct breakdown)

## Related skills

- `act-architect` — For goals where the user already knows the direction; direct breakdown into issues.
- `act-repo-issue-create` — Used to create issues; retry on TLS errors if needed.
- `act-pm` — Handoff for prioritization and "what's next?" after issues are created.

---
name: meta-discovery
description: Evaluate whether the current task reveals a pattern worth capturing as a reusable skill. Runs at the end of every substantive interaction.
---

# Skill Discovery

> **When to run:** At the *end* of your response, not at the beginning. Do not evaluate until you have finished the user's request. This is a final-step checkpoint — treat it as the last thing you do before concluding.

After completing a user's request, briefly evaluate whether the work just done — or the pattern it represents — should be captured as a new or updated skill. If it should, suggest it to the user.

## When to use

**Always active.** Run this evaluation as the final step of every substantive interaction.

Skip only when:

- The interaction is pure Q&A with no code or workflow involved.
- The task is trivial and single-step (rename a variable, fix a typo).

## Discovery categories

Look for these patterns. Each one is a signal that a skill may be worth creating.

### 1. Root-repo management

A multi-step task that configures this root repo itself (e.g. managing git submodules, switching which projects are imported). These are reserved for the agents root, not for individual projects.

Skill prefix: `root-`

### 2. One-off setup

A multi-step configuration task that would apply to any new project or major milestone. Examples: setting up CI, configuring linting, scaffolding documentation structure.

Skill prefix: `project-`

### 3. Repeated workflows

Work done more than once following similar steps: implementing features, fixing bugs, adding documentation, preparing releases, writing tests, updating the changelog.

Skill prefix: `act-`

### 4. Troubleshooting patterns

Diagnosing and fixing a class of problem with reproducible steps. Examples: "CI fails because of X", "flaky tests caused by Y", "build breaks after dependency update".

Skill prefix: `act-`

### 5. Cross-cutting changes

A task that touches multiple files or modules in a predictable structure. Example: adding a new crawler type always requires updating types, config, tests, and docs.

Skill prefix: `act-`

### 6. Decision frameworks

Architectural or design decisions that should be consistent across the codebase. Examples: error handling strategy, backwards compatibility approach, naming conventions, how to structure tests.

Skill prefix: `project-` or `act-` depending on whether it's a one-time decision or recurring.

### 7. Periodic audits

Recurring reviews done on a schedule: dependency audits, performance checks, security scans, license compliance.

Skill prefix: `act-`

### 8. Migration patterns

Upgrading major dependencies, adapting to upstream breaking changes, moving between APIs, converting between module systems.

Skill prefix: `act-`

## Workflow

**Format:** All skills MUST use `### Phase N: Title` for each workflow step. Enforced by validation script in CI.

**Skill-eval (meta-evaluation):** From the project root, run `./scripts/skill-eval.sh start {session_id} meta-discovery` at workflow start (session_id is injected at session start—look for "Session ID (for skill-eval)" in context). Capture the printed `skill_id` from the terminal output. Preserve both `session_id` and `skill_id` for the duration—if context gets summarized, ensure these IDs are retained. After each phase (or when skipping a phase), run `./scripts/skill-eval.sh complete {skill_id} {phase_no}` or `./scripts/skill-eval.sh complete {skill_id} {phase_no} --skipped` from the project root.

Create todo tasks for each phase before proceeding.

### Phase 1: Evaluate

After completing the user's request, ask yourself:

1. Did this task involve **3 or more steps**?
2. Is this something that is **likely to happen again** -- either in this project or in similar projects?
3. Does a skill for this **already exist**? (Check `.cursor/skills/` directory.)
4. Would a skill meaningfully **reduce effort or mistakes** next time?

If the answer to (1) and (2) is yes, and (3) is no, and (4) is yes -- suggest a skill.

If a skill already exists but is **missing steps or outdated** based on what you just did, suggest updating it instead.

### Phase 2: Suggest

Append a brief suggestion to the end of your response. Keep it to one or two sentences. Format:

```
This [description of pattern] could be captured as a `{prefix}-{name}` skill. Want me to create it?
```

Examples:

- "This dependency upgrade workflow could be captured as an `act-dependency-upgrade` skill. Want me to create it?"
- "The steps for adding a new crawler type could be captured as an `act-add-crawler-type` skill. Want me to create it?"
- "The existing `act-dev-changelog` skill doesn't cover the case where we backfill entries for older releases. Want me to update it?"

Do **not** create the skill unless the user says yes. If they agree, use the `meta-skill-create` skill to create it.

## Verification

```
- [ ] Evaluation runs after substantive interactions (not trivial or Q&A-only)
- [ ] Suggestion is at the end of the response, not interrupting the main work
- [ ] Suggestion names a specific skill prefix and topic
- [ ] Suggestion is at most 1-2 sentences
- [ ] No skill is created without user confirmation
- [ ] Existing skills are checked before suggesting a new one
```

## Out of scope

- Actually creating or writing the skill -- see the `meta-skill-create` skill.
- Deciding on skill directory structure or naming conventions -- see the `meta-skill-create` skill.

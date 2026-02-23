---
name: act-worker
description: Execute development work from a pool of GitHub issues. Take one at a time, implement via act-dev, close the issue when done. Use when architect/PM has produced a backlog of issues to implement in parallel.
---

# Worker

Implements development work from a pool of GitHub issues. Picks one, runs the full act-dev workflow, closes the issue when done, then moves to the next. Multiple workers can take different issues from the same pool for parallel execution.

## When to use

Trigger this skill when:

- The user has a pool of GitHub issues to implement (e.g. from architect breakdown, PM backlog).
- The user says "implement these issues", "workers go", "take from pool", or "distribute to workers".
- The user provides a list of issue numbers (e.g. #5, #6, #7) and wants them implemented.
- After architect creates work packages and PM prioritizes, the user wants execution to start.

## Workflow

**Format:** All skills MUST use `### Phase N: Title` for each workflow step. Enforced by validation script in CI.

**Skill-eval (meta-evaluation):** From the project root, run `./scripts/skill-eval.sh start {session_id} act-worker` at workflow start (session_id is injected at session start—look for "Session ID (for skill-eval)" in context). Capture the printed `skill_id` from the terminal output. Preserve both `session_id` and `skill_id` for the duration—if context gets summarized, ensure these IDs are retained. After each phase (or when skipping a phase), run `./scripts/skill-eval.sh complete {skill_id} {phase_no}` or `./scripts/skill-eval.sh complete {skill_id} {phase_no} --skipped` from the project root.

Create todo tasks for each phase before proceeding.

### Phase 1: Identify pool

1. **Determine the pool** — Where do the issues come from?
   - User-provided list (e.g. "implement #5, #6, #7")
   - Architect handoff (umbrella issue linking sub-issues)
   - PM backlog (INBOX items promoted to issues; Now/Next section)
   - **Search for available issues** (multi-worker): `gh issue list -S "is:open no:assignee"` — one call returns all unclaimed issues. Optionally add `label:initiative-name` to scope.
   - Single issue: treat as a pool of one
2. **Resolve issue numbers** — Fetch issue details via `gh issue view <number>` if needed. Note dependencies (Blocks #X).
3. **Order by dependency** — Work on unblocked issues first. If A blocks B, do A before B.

**Output:** Ordered list of issue numbers to implement.

### Phase 2: Pick and claim

1. **Pick one issue** from the pool (or user assigns).
2. **Claim it** — Run `gh issue edit #N --add-assignee @me`. This marks the issue as taken so other workers skip it. One atomic call; no label or comment needed. Available pool uses `no:assignee`, so claimed issues disappear from other workers' searches.
3. **Read the issue** — Scope, acceptance criteria, design doc links.
4. **Confirm with user** (optional for single-worker flow): "Claimed #N: {title}. Proceeding."

**Output:** One issue in focus, claimed.

### Phase 3: Implement

1. **Run act-dev** for this issue:
   - Treat the issue as the request (e.g. "Implement #N: {title}").
   - Follow the full act-dev workflow: design, implement, test, validate, docs, changelog, review, PR.
   - act-dev will close the issue via PR (`Closes #N`) or, if PR skipped, via `gh issue close #N`.
2. **If act-dev completes but the issue is still open** (e.g. user skipped PR and act-dev did not close): run `gh issue close #N --comment "Implemented. [brief summary]"`.

**Output:** Issue implemented; linked GitHub issue closed.

### Phase 4: Next or done

1. **Remove** the completed issue from the pool (mental or explicit list).
2. **If pool has more:** Return to Phase 2 (pick next issue).
3. **If pool is empty:** Summarize what was completed (issues closed, PRs created). Report done.

**Output:** Pool depleted or user stops.

## Close linked issue (responsibility)

**When work on an issue is complete, the linked GitHub issue must be closed.** This applies whether implementation was done by this worker or delegated to act-dev.

- **Preferred:** PR with `Closes #N` in the body. When merged, GitHub auto-closes the issue.
- **Fallback:** If PR was skipped or not yet merged, run `gh issue close #N --comment "Implemented. [brief summary of changes]"`.

Never leave a completed implementation's issue dangling.

## Verification

- [ ] Pool identified and ordered (dependencies respected)
- [ ] Each issue implemented via act-dev
- [ ] Linked GitHub issue closed when work is done (via PR or `gh issue close`)
- [ ] Pool processed until empty or user stops

## Out of scope

- Creating GitHub issues — see `act-repo-issue-create` or architect skills
- Prioritization of the pool — PM owns that
- Single ad-hoc implementation without pool — use `act-dev` directly
- Architect-level design — see `act-architect`, `act-arch-solution-create`

## Related skills

- `act-dev` — Used for each issue's implementation; includes close-issue responsibility.
- `act-pm` — Curates backlog; workers take from it when user wants execution.
- `act-architect` / `act-arch-solution-create` — Create the issues that become the pool.

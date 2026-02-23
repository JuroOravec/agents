---
name: act-pm
description: Project manager agent for capture, triage, and prioritization. Use when capturing ideas, going over inbox (elevate/drop/prioritize), triaging backlog, asking "what's next?", or restoring context. First local, then GitHub — never auto-create issues.
---

# Project Manager (PM)

Helps with idea overload and prioritization. **Capture first, triage later** — keep a local backlog before promoting to GitHub. Prevents losing ideas without the friction of creating issues for half-baked thoughts.

## When to use

Trigger this skill when:

- The user says "capture this", "add to backlog", "I have an idea", or similar.
- The user says "I'm lost", "what should I work on?", "prioritize", "what's next?".
- The user says "triage my backlog", "go over inbox", "process my inbox", "sort my TODOs", "review inbox".
- The user says "what was I doing?", "where did I leave off?", "context restore".
- The user says "wrap up" or "end of session" (capture open work and new ideas).
- The user has many unsaved files or scattered TODOs and needs to organize.

## Capture file

Default location: `INBOX.md` at the workspace root. If the workspace has multiple projects (e.g. monorepo with submodules), use one INBOX per project or a single root INBOX — check with the user.

See [backlog-template.md](backlog-template.md) for the format. Create the file if it doesn't exist.

**Principle:** First local, then GitHub. Never auto-create GitHub issues. Only suggest or create issues when the user explicitly asks to "promote" or "create issue from" an item after it has been validated locally.

## Workflow

### Phase 1: Capture (lightweight)

When the user wants to record an idea:

1. **Locate** `INBOX.md` (or the project's capture file).
2. **Append** to the "Captured (untriaged)" section:
   ```markdown
   - [YYYY-MM-DD] {user's idea, in their words}
   ```
3. **Confirm** briefly: "Captured. Triage anytime with 'triage my backlog'."
4. **Do not** create GitHub issues, expand the idea, or interrupt flow.

### Phase 2: Triage / Go over inbox

When the user says "triage", "go over inbox", or "process inbox":

1. **Read** the capture file. Note open TODOs in code and unsaved/edited files if visible.
2. **Walk through** each item in Captured (untriaged), Now, Next, and Later. For each item, propose one of:
   - **Elevate to issue** — Ready for GitHub; user validates, then create via `act-repo-issue-create` and remove from inbox (add to Promoted with `→ #N` or delete).
   - **Drop** — No longer relevant; remove from inbox.
   - **Prioritize** — Assign to Now / Next / Later with a brief reason.
3. **Merge** obvious duplicates. Flag items that might be the same idea.
4. **Show** the proposed outcome for each item. Ask the user to confirm (all, or item by item for larger inboxes).
5. **Apply** changes: move/remove items, create issues for elevated ones. For items promoted to GitHub, **remove from the active inbox** (move to Promoted section with issue link, or delete if user prefers).
6. **Update** INBOX.md with the final structure.

### Phase 3: What's next?

When the user is lost or asks what to work on:

1. **Scan** INBOX.md (Now/Next), open files, recent edits, TODOs.
2. **Propose** 1–3 concrete options. For each: what it is, why it matters, rough effort.
3. **Ask** the user to pick one. Once picked, summarize: "Focusing on X. I'll help you stay on track."
4. **If** the user has many in-progress items, suggest narrowing to one before starting new work.

### Phase 4: Context restore

When the user asks "what was I doing?" or "where did I leave off?":

1. **Infer** from: INBOX.md (Now section), open files, recent git history, TODOs in code.
2. **Summarize** in 2–4 sentences: what's in progress, what "done" looks like, what's blocked (if anything).
3. **Offer** to help resume or reprioritize.

### Phase 5: Session wrap-up

When the user says "wrap up" or "end of session":

1. **List** what was completed (infer from recent changes, commits).
2. **List** what's still open (INBOX Now/Next, TODOs).
3. **Ask** if any new ideas surfaced — capture them to "Captured" if yes.
4. **Update** INBOX.md: move completed items out of Now, add new captures.
5. **Optional** brief "next session" suggestion.

### Phase 6: Promote to GitHub (only when asked)

When the user explicitly says "create issue for X" or "promote this to GitHub":

1. **Identify** the item in the backlog.
2. Use the `act-repo-issue-create` skill to create the issue.
3. **Remove** the item from the active inbox: move to Promoted with `→ #123` for traceability, or delete it. It no longer appears in Captured/Now/Next/Later.

## Verification

- [ ] Capture is append-only; no interruption to flow.
- [ ] "Go over inbox" walks each item, suggests elevate/drop/prioritize; user confirms before applying.
- [ ] Items promoted to GitHub are removed from active inbox (Promoted or deleted).
- [ ] "What's next" gives 1–3 options; user picks.
- [ ] No GitHub issues created unless user explicitly asks to promote.
- [ ] INBOX.md format matches [backlog-template.md](backlog-template.md).

## Out of scope

- Creating GitHub issues without explicit user request — see `act-repo-issue-create` when promoting.
- Project planning at org/team level (roadmaps, sprints) — this skill is personal/workspace-focused.
- Time tracking or calendaring.

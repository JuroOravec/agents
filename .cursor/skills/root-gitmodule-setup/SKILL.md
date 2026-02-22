---
name: root-gitmodule-setup
description: Configure which projects are connected to a root repo via git submodules. Applies only when the repo has shared .cursor/ and nested projects as git submodules. Use when adding, removing, or soft/hard switching projects. Soft switch = toggle .gitignore (no push, WIP stays). Hard switch = remove/add submodule. Handles progress storage, commit/push, and window reload reminders.
---

# Root Git Module Setup

Guides the user through configuring git submodules in a root repo. This skill covers adding projects, removing projects, and switching between projects. See `docs/project-setup.md` for the conceptual overview.

## Scope

This skill applies **only** when you have a **root repo** with this setup:

1. **Shared `.cursor` config** — The root repo stores a single `.cursor/` directory (agents, skills, rules) at its root.
2. **Projects as git submodules** — Individual projects are imported as git submodules under the root; they are real directories, not symlinks.
3. **Shared AI guidance** — All imported projects use the same agents, skills, and rules defined in the root's `.cursor/`.

```
root-repo/                      ← root (this skill applies here)
├── .cursor/                   ← shared config (one definition for all)
│   ├── agents/
│   ├── rules/
│   └── skills/
├── project-a/                 ← git submodule (imported)
├── project-b/                 ← git submodule (imported)
├── .gitmodules
└── ...
```

If the workspace is a plain single-project repo (or a monorepo without this submodule pattern), this skill does not apply.

## When to use

Trigger this skill when:

- Adding one or more projects to this root repo as git submodules.
- Removing one or more projects from this root repo.
- Switching projects — soft (toggle `.gitignore`) or hard (remove one submodule, add another).
- The user asks to "add a project", "remove a project", "switch projects", or "configure submodules".

## Prerequisites

- You are in a root repo with the setup described above (shared `.cursor/` and projects as git submodules).
- For adding: the repo URL and branch are known or will be provided by the user.
- For removing: the user has decided whether to store progress (see Phase 2 below).

## Workflow

### Phase 1: Determine intent

Ask the user which operation they want:

1. **Add** — add one or more projects as submodules.
2. **Remove** — remove one or more projects (hard switch).
3. **Switch** — change which project(s) are in focus. Two modes:
   - **Soft switch** — Toggle `.gitignore` so tooling skips projects you're not using. Prettier and Cursor (when no `.cursorignore`) respect `.gitignore`; ESLint needs `includeIgnoreFile` from `@eslint/compat`. No git changes to submodules; WIP stays local.
   - **Hard switch** — Remove one submodule and add another. Requires progress storage before remove. Use when you want to actually drop a project from the repo.

**If the user says "switch" or "change projects" and the intent is unclear**, ask: "Do you want a **soft switch** (toggle .gitignore to reduce focus — no push, WIP stays) or a **hard switch** (remove submodule and add another — requires storing progress first)?" If still ambiguous after asking, **default to soft**.

### Phase 2a: Soft switch (toggle .gitignore)

When switching projects without removing submodules:

1. **Identify projects** — which to deactivate (add to ignores) and which to activate (remove from ignores).
2. **Edit `.gitignore`** — add paths for projects to ignore (e.g. `crawlee-one/`), remove or comment out paths to activate. If you have a separate `.cursorignore`, manage it together with `.gitignore`; otherwise Cursor uses `.gitignore`. For ESLint at root: ensure `eslint.config.js` uses `includeIgnoreFile` from `@eslint/compat` to import `.gitignore`.
3. **Remind** — "Reload the window (Developer: Reload Window) for indexing and tooling to pick up the change. Your WIP in the deactivated project stays local — no push needed."

**Git note:** If the user later needs to update a submodule pointer in the parent while that path is in `.gitignore`, they may need `git add -f <path>`.

### Phase 2b: Add projects

For each project to add:

1. **Ask for repo URL** — e.g. `https://github.com/owner/repo.git` or `git@github.com:owner/repo.git`.
2. **Ask for branch** — which branch to track. Default: `main` if the user does not specify.
3. **Choose path** — typically the repo name (e.g. `crawlee-one`, `actor-spec`). Confirm with the user if ambiguous.
4. **Run:**

   ```bash
   git submodule add -b <branch> <repo-url> <path>
   ```

5. **Commit** (or defer until all adds are done):

   ```bash
   git add .gitmodules <path>
   git commit -m "Add <project> as submodule"
   ```

**Reminder:** After adding, switching, or removing submodules, the workspace may need a **window reload** (e.g. Cursor: Developer: Reload Window) for indexing to pick up the changes. Remind the user at the end of the workflow.

### Phase 3: Remove projects (including switch)

Before removing any project:

1. **Ask about progress storage** — "Do you want to store progress before removing? Where? (e.g. push to the project's own repo, create a backup branch, or skip if there is no uncommitted work)"
2. **If storing progress:**
   - Ensure all changes in the submodule are committed.
   - Push to the project's own remote: `cd <path> && git push origin <branch>` (or the user's chosen destination).
   - If the user wants a backup branch, create and push it: `git checkout -b backup-<date> && git push origin backup-<date>`.
3. **Commit and push** the root repo's submodule pointer if it changed (e.g. after a `git submodule update --remote` in the submodule).
4. **Then remove** the submodule:

   ```bash
   git submodule deinit -f <path>
   git rm -f <path>
   rm -rf .git/modules/<path>
   ```

5. **Commit:**

   ```bash
   git commit -m "Remove <project> submodule"
   ```

**If hard switching:** After removing, proceed to Phase 2b to add the replacement project.

**Reminder:** Switching or removing submodules may require a **window reload** for Cursor to refresh indexing. Remind the user at the end.

### Phase 4: Window reload reminder

After any add, remove, or switch operation, tell the user:

> Submodule changes may require a **window reload** for Cursor to re-index. Use **Developer: Reload Window** (Cmd+Shift+P) if the new project does not appear in search or if the removed project still appears.

## Verification

- [ ] User's intent (add / remove / switch) is confirmed before executing.
- [ ] For add: repo URL and branch are confirmed; path is clear.
- [ ] For remove: progress storage is offered; commit and push happen before deinit.
- [ ] `git submodule deinit`, `git rm`, and optional `rm .git/modules/<path>` are run in the correct order.
- [ ] Window reload reminder is given at the end.

## Out of scope

- Cloning the root repo with submodules — see `docs/project-setup.md`.
- Updating submodules to latest (`git submodule update --remote`) — that is a routine maintenance task, not configuration.
- Creating or modifying skills, agents, or rules — see `meta-skill-write`, `project-polish`, etc.

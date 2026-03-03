# Project Setup: Shared Cursor Config with Nested Git Clones

This document describes the setup of this repository: a central "agents" root that holds shared Cursor configuration (agents, skills, rules) and imports individual projects as regular nested git clones, so all projects benefit from the same AI guidance.

## Overview

```
agents/                    ← root repo (this repo)
├── .cursor/               ← shared Cursor config
│   ├── agents/
│   ├── rules/
│   └── skills/
├── actor-spec/            ← imported project (independent git clone)
├── crawlee-one/           ← another project (independent git clone)
├── docs/
├── package.json           ← fixes TypeScript linter
└── ...
```

**Key idea:** Open this root repo in Cursor. All nested clones are indexed together and use the single `.cursor/` definitions. No need to duplicate agents/skills/rules across each project.

## Why This Works

- **One source of truth** - Update a skill or rule once; it applies to every imported project.
- **Proper indexing** - Nested clones are real directories, so Cursor indexes them. Symlinks are skipped by Cursor's indexer.
- **Isolated histories** - Each project keeps its own git history and remote.
- **Simpler root git state** - The root repo does not track per-project commit pointers.

## Workflow: Add a Project (Nested Clone)

To import a project into this repo:

```bash
# From the agents repo root
git clone -b <branch> <repo-url> <path>

# Example: add crawlee-one
git clone -b dev/crawlee-one-v4 https://github.com/JuroOravec/crawlee-one.git crawlee-one
```

Then add the path to root `.gitignore` so the root repo does not track the nested project:

```bash
echo "<path>/" >> .gitignore
git add .gitignore
git commit -m "chore: ignore nested project <path>"
```

## Workflow: Remove a Project (Nested Clone)

To remove a project from this repo:

```bash
# 1. Ensure project progress is stored (commit/push) in the nested repo if needed
cd <path> && git status

# 2. Remove folder from root workspace
cd ..
rm -rf <path>

# 3. Keep or remove ignore entry, then commit root metadata change
git add .gitignore
git commit -m "chore: remove nested project <path>"
```

Example for `actor-spec`:

```bash
cd actor-spec && git status
cd ..
rm -rf actor-spec
git add .gitignore
git commit -m "chore: remove nested project actor-spec"
```

## Soft switching (focus without removing)

When you have many nested projects, indexing and tooling (ESLint, Prettier, Cursor) can slow down. **Soft switching** lets you focus on 1–2 projects at a time without removing folders or pushing WIP.

**How it works:** Toggle project paths in `.gitignore` to exclude/include them. Your WIP stays local; no commit or push needed.

**Which tools respect `.gitignore`?**

- **Cursor** - uses `.gitignore` when no `.cursorignore` is specified. If you have a separate `.cursorignore`, manage it together with `.gitignore` for soft switching.
- **Prettier** - respects `.gitignore` by default.
- **ESLint** - does _not_ respect `.gitignore` by default. To use it, add `includeIgnoreFile` from `@eslint/compat` to your root `eslint.config.js` to import `.gitignore` patterns.

### Example `.gitignore` (root)

```
node_modules/

# Soft-switch: remove a line to activate that project
actor-spec/
# crawlee-one/
```

### Switching focus

1. Add the project you're leaving to `.gitignore` (e.g. `crawlee-one/`).
2. Remove (or comment out) the project you want to work on from `.gitignore` (e.g. `actor-spec/`).
3. Reload the window (Developer: Reload Window).
4. Your WIP in the previous project stays in place - no push required.

**Git note:** For nested clones, `.gitignore` only affects the root repo. It does not alter the nested project's own git tracking.

---

## Cloning and Updating

**Initial clone (root):**

```bash
git clone <agents-repo-url>
```

**Add projects later as needed:**

```bash
git clone -b <branch> <repo-url> <path>
echo "<path>/" >> .gitignore
```

## Notes

- **Root `package.json`** - The root has a minimal `package.json` (with `@types/node`) so that Node built-in imports like `node:path` and `node:fs` resolve correctly in TypeScript when editing files across nested projects.
- **Do not use symlinks** for imported projects. Cursor does not index symlinked directories. Use real directories via `git clone`.
- **Nested clone vs symlink** - Both can have nested `.git`, but clones are real directories and get indexed; symlinks do not.
- **Soft vs hard** - Use soft switching (`.gitignore`) to focus without removing. Use hard switching (remove one clone folder, clone another) when you want to actually drop a project from the root.
- If a project was previously a symlink, remove it with `rm <path>` before cloning it into place.

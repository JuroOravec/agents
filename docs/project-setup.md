# Project Setup: Shared Cursor Config with Git Submodules

This document describes the setup of this repository: a central "agents" root that holds shared Cursor configuration (agents, skills, rules) and imports individual projects as git submodules, so all projects benefit from the same AI guidance.

## Overview

```
agents/                    ← root repo (this repo)
├── .cursor/               ← shared Cursor config
│   ├── agents/
│   ├── rules/
│   └── skills/
├── actor-spec/            ← imported project (git submodule)
├── crawlee-one/           ← another project (git submodule)
├── docs/
├── .gitmodules
├── package.json           ← Fixes Typescript linter
└── ...
```

**Key idea:** Open this root repo in Cursor. All submodules are indexed together and use the single `.cursor/` definitions. No need to duplicate agents/skills/rules across each project.

## Why This Works

- **One source of truth** - Update a skill or rule once; it applies to every imported project.
- **Proper indexing** - Submodules are real directories, so Cursor indexes them. Symlinks are skipped by Cursor's indexer.
- **Isolated histories** - Each project keeps its own git history; submodules are just pointers to commits.
- **Simple clone** - `git clone --recurse-submodules` brings everything down.

## Workflow: Add a Git Submodule

To import a project into this repo:

```bash
# From the agents repo root
git submodule add <repo-url> <path>

# Example: add crawlee-one
git submodule add https://github.com/JuroOravec/crawlee-one.git crawlee-one
```

This will:

1. Clone the repo into `<path>`
2. Create/update `.gitmodules`
3. Record the submodule in the index (ready to commit)

Then commit the changes:

```bash
git add .gitmodules <path>
git commit -m "Add <project> as submodule"
```

## Workflow: Remove a Git Submodule

To remove a project from this repo:

```bash
# 1. Deinit and remove the submodule (does not delete .git/modules/<name> by default)
git submodule deinit -f <path>
git rm -f <path>

# 2. (Optional) Remove leftover module metadata
rm -rf .git/modules/<path>

# 3. Commit
git commit -m "Remove <project> submodule"
```

Example for `actor-spec`:

```bash
git submodule deinit -f actor-spec
git rm -f actor-spec
rm -rf .git/modules/actor-spec
git commit -m "Remove actor-spec submodule"
```

## Soft switching (focus without removing)

When you have many submodules, indexing and tooling (ESLint, Prettier, Cursor) can slow down. **Soft switching** lets you focus on 1–2 projects at a time without removing submodules or pushing WIP.

**How it works:** Add submodule paths to `.gitignore` to exclude them. Your WIP stays local; no commit or push needed.

**Which tools respect `.gitignore`?**
- **Cursor** - uses `.gitignore` when no `.cursorignore` is specified. If you have a separate `.cursorignore`, manage it together with `.gitignore` for soft switching.
- **Prettier** - respects `.gitignore` by default.
- **ESLint** - does *not* respect `.gitignore` by default. To use it, add `includeIgnoreFile` from `@eslint/compat` to your root `eslint.config.js` to import `.gitignore` patterns.

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

**Git note:** An already-tracked submodule in `.gitignore` remains tracked. If you need to update the submodule pointer in the parent (e.g. after pulling in the submodule), use `git add -f <path>` when committing.

---

## Cloning and Updating

**Initial clone (with submodules):**

```bash
git clone --recurse-submodules <agents-repo-url>
```

**Already cloned; fetch submodules:**

```bash
git submodule update --init --recursive
```

**Update all submodules to latest remote:**

```bash
git submodule update --remote --merge
```

## Notes

- **Root `package.json`** - The root has a minimal `package.json` (with `@types/node`) so that Node built-in imports like `node:path` and `node:fs` resolve correctly in TypeScript when editing files across submodules.
- **Do not use symlinks** for imported projects. Cursor does not index symlinked directories. Use submodules instead.
- **Submodule vs symlink** - Both can have nested `.git`, but submodules are real directories and get indexed; symlinks do not.
- **Soft vs hard** - Use soft switching (`.gitignore`) to focus without removing. Use hard switching (remove submodule, add another) when you want to actually drop a project from the repo.
- If a project was previously a symlink, remove it with `rm <path>` before adding it as a submodule.

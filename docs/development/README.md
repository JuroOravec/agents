# Development Guide

Internal guide for contributors to the agents repo. This root holds shared Cursor configuration (agents, skills, rules) and imports projects as git submodules.

## Prerequisites

- **Node.js** — Used for TypeScript resolution when editing files across submodules. The root `package.json` provides `@types/node` so built-ins like `node:path` resolve correctly.
- **Git** — Standard git with submodule support.
- **Cursor** (or compatible AI editor) — The `.cursor/` config targets Cursor; the pattern works with other tools that support similar layouts.

Submodules have their own prerequisites (pnpm, Node version, etc.). Check each project's docs.

## Project structure

```
agents/                    ← root repo
├── .cursor/               ← shared Cursor config (ONE source of truth)
│   ├── agents/            ← agent/role definitions
│   ├── rules/             ← always-applied rules
│   └── skills/             ← reusable skills (prompts, workflows)
├── docs/                   ← documentation
│   ├── development/        ← this guide
│   └── project-setup.md    ← submodule workflow
├── project-a/            ← imported project (git submodule)
├── project-b/            ← imported project (git submodule)
├── .gitmodules
├── package.json            ← minimal; fixes TypeScript resolution
└── ...
```

## Architecture

- **Entry points** — No library code at root. Open the root in Cursor; submodules are indexed and share `.cursor/` config.
- **Core flow** — Agents and rules apply globally. Skills are invoked when the AI detects a relevant task. Each submodule has its own build, test, and lint pipelines.
- **Submodule model** — Real directories (not symlinks), so Cursor indexes them. Each project keeps its own git history; the root stores commit pointers.

## Root commands

The root `package.json` is minimal. No build, test, or lint at root. All development commands live inside submodules. Run them from the relevant submodule directory:

```bash
cd crawlee-one && pnpm build
cd crawlee-one && pnpm test
```

## Adding and removing projects

See [docs/project-setup.md](../project-setup.md) for:

- Adding a submodule
- Removing a submodule
- Soft switching (toggle `.gitignore` to focus on 1–2 projects without removing)

For AI-assisted setup, use the [`root-gitmodule-setup`](../../.cursor/skills/root-gitmodule-setup/SKILL.md) skill.

## Editing agents, skills, rules

- **Agents** — `.cursor/agents/*.md` — Role definitions and discovery prompts.
- **Rules** — `.cursor/rules/*.md` — Always-applied guidance (coding standards, conventions).
- **Skills** — `.cursor/skills/*/SKILL.md` — Reusable workflows. See [.cursor/skills/README.md](../../.cursor/skills/README.md).

Changes apply to all submodules immediately. No build step.

## Branch protection

To protect `main` (require PRs, require up-to-date branches), run (requires `gh` and repo admin):

```bash
gh api repos/JuroOravec/agents/branches/main/protection --method PUT \
  -H "Accept: application/vnd.github+json" --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "checks": []
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0
  },
  "restrictions": null
}
EOF
```

There is no CI at root, so `checks` is empty. Add CI job names when/if CI is added.

## Further reading

- [docs/project-setup.md](../project-setup.md) — Submodule workflows, soft vs hard switching
- [root-gitmodule-setup skill](../../.cursor/skills/root-gitmodule-setup/SKILL.md) — AI-assisted add/remove/switch
- [Skills README](../../.cursor/skills/README.md) — Overview of available skills

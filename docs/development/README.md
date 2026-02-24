# Development Guide

Internal guide for contributors to the agents repo. This root holds shared Cursor configuration (agents, skills, rules) and imports projects as nested git clones.

## Prerequisites

- **Node.js** — Used for TypeScript resolution when editing files across nested projects. The root `package.json` provides `@types/node` so built-ins like `node:path` resolve correctly.
- **Git** — Standard git tooling.
- **Cursor** (or compatible AI editor) — The `.cursor/` config targets Cursor; the pattern works with other tools that support similar layouts.

Nested projects have their own prerequisites (pnpm, Node version, etc.). Check each project's docs.

## Project structure

```
agents/                    ← root repo
├── .cursor/               ← shared Cursor config (ONE source of truth)
│   ├── agents/            ← agent/role definitions
│   ├── rules/             ← always-applied rules
│   └── skills/             ← reusable skills (prompts, workflows)
├── docs/                   ← documentation
│   ├── development/        ← this guide
│   └── project-setup.md    ← nested-clone workflow
├── project-a/            ← imported project (independent git clone)
├── project-b/            ← imported project (independent git clone)
├── package.json            ← minimal; fixes TypeScript resolution
└── ...
```

## Architecture

- **Entry points** — No library code at root. Open the root in Cursor; nested projects are indexed and share `.cursor/` config.
- **Core flow** — Agents and rules apply globally. Skills are invoked when the AI detects a relevant task. Each nested project has its own build, test, and lint pipelines.
- **Nested clone model** — Real directories (not symlinks), so Cursor indexes them. Each project keeps its own git history.

## Root commands

The root `package.json` is minimal. One validation script runs at root; all other development commands live inside nested projects.

```bash
pnpm run validate   # Validate skill phase format (see below)
pnpm run preview    # Skill-eval dashboard (heatmap + line chart) at http://localhost:3040
cd crawlee-one && pnpm build
cd crawlee-one && pnpm test
```

### Skill-eval dashboard

`pnpm run preview` starts a local web server at http://localhost:3040. The **Skills** page shows:

- **Heatmap** — skill × phase; each cell is 0–100% success rate (green = 100%, red = 0%)
- **Line chart** — each skill over time; Y = 0–100% (completed phases / expected phases)

Data is read from `.cursor/logs/skills/`. Use `-p 3000` to change the port.

**Full setup guide:** [docs/skill-usage-tracking/](../skill-usage-tracking/README.md)

![skill-eval dashboard](../skill-usage-tracking/skill-eval-dashboard.png)

### Skill phase validation

`pnpm run validate` runs `scripts/validate/index.ts`, which discovers and runs all validation scripts. The main one is **skill-phases** (see `scripts/validate/skill-phases.ts`).

**What it checks:** Every `###` heading under `## Workflow` in `.cursor/skills/*/SKILL.md` must use the format:

```
### Phase N: Title
### Phase Na: Title   (optional a/b suffix for sub-phases like 2a, 8b)
```

**Regex:** `^### Phase (\d+)([ab])?: (.+)$`

**Violations:**

- **Non-Phase format** — e.g. `### 1. Step`, `### Adding a new dependency` (use `### Phase 1: Step`, `### Phase 1: Adding a new dependency` instead)
- **Duplicate phases** — Two `### Phase 2: ...` in the same skill

**Exempt:** Subheadings like `### Reference:`, `### Output:`, `### Format:` are metadata, not workflow steps, and are not flagged.

**Design:** [docs/design-decisions/meta-skill-evaluation/](../design-decisions/meta-evaluation/) (phase format enforcement is a prerequisite for skill-eval tracking).

## Adding and removing projects

See [docs/project-setup.md](../project-setup.md) for:

- Adding a nested project clone
- Removing a nested project clone
- Soft switching (toggle `.gitignore` to focus on 1–2 projects without removing)

For AI-assisted setup, use the [`root-project-setup`](../../.cursor/skills/root-project-setup/SKILL.md) skill.

## Editing agents, skills, rules

- **Agents** — `.cursor/agents/*.md` — Role definitions and discovery prompts. See [agents vs skills](../agents-and-skills.md) for how they differ from skills.
- **Rules** — `.cursor/rules/*.md` — Always-applied guidance (coding standards, conventions).
- **Skills** — `.cursor/skills/*/SKILL.md` — Reusable workflows. See [.cursor/skills/README.md](../../.cursor/skills/README.md).

Changes apply to all nested projects immediately. No build step.

## CI

`.github/workflows/tests.yml` runs on every push and PR to `main`:

- **validate** — Runs `pnpm run validate` (skill phase format, any future validators)

## Branch protection

To protect `main` (require PRs, require up-to-date branches), run (requires `gh` and repo admin):

```bash
gh api repos/JuroOravec/agents/branches/main/protection --method PUT \
  -H "Accept: application/vnd.github+json" --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "checks": [{"context": "validate"}]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0
  },
  "restrictions": null
}
EOF
```

CI job name for branch protection: `validate`.

## Further reading

- [docs/agents-and-skills.md](../agents-and-skills.md) — Agent vs skill: persona vs procedure
- [docs/project-setup.md](../project-setup.md) — Nested clone workflows, soft vs hard switching
- [root-project-setup skill](../../.cursor/skills/root-project-setup/SKILL.md) — AI-assisted add/remove/switch
- [Skills README](../../.cursor/skills/README.md) — Overview of available skills

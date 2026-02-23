# One AI config to rule all repos

**How I stopped duplicating agents, skills, and rules across every repo - and why you might want to do the same.**

---

If you use an AI coding assistant - Cursor, Claude Code, Codeium, Windsurf, or similar - and maintain more than one project, you've probably felt the pain: 

You craft a solid set of rules, prompts, and agent definitions in one repo, and then you copy them into the next. And the next. Before long, you're maintaining five versions of the same config, and improvements in one place never make it to the others.

There's a better way.

## The idea: one root, many projects

Instead of scattering your AI config across each repo, put it in a **single root repository** and import your projects as **git submodules**. Open that root in your editor, and every project inside it shares the same rules and definitions. Update once, apply everywhere.

*This repo is set up for Cursor (`.cursor/` with agents, skills, rules). The same pattern works for other tools - just swap in their config layout.*

```
agents/                    ← you open this
├── .cursor/               ← ONE definition of agents, skills, rules
│   ├── agents/
│   ├── rules/
│   └── skills/
├── my-api/                ← your projects (git submodules)
├── my-dashboard/
├── my-scraper/
└── ...
```

All submodules are indexed together. The AI has full context. No duplication, no drift.

## Why submodules (and not symlinks)?

You might think: "Can't I just symlink my projects into a mega folder?" You can, but many AI tools **don't index symlinks** - Cursor, for example, skips them, so the AI can't see the files. Git submodules are real directories; they get indexed and everything works.

Each project keeps its own git history. The root repo just holds pointers to specific commits. Clean, standard, and it plays nicely with `git clone --recurse-submodules`.

## Getting started

### 1. Clone this repo

```bash
git clone --recurse-submodules https://github.com/JuroOravec/agents.git
cd agents
```

### 2. Add your projects

```bash
git submodule add https://github.com/you/your-project.git your-project
git add .gitmodules your-project
git commit -m "Add your-project as submodule"
```

Open the repo in Cursor. Your projects are now inside, sharing the same `.cursor/` config. Edit a skill once, and it applies to every project.

### 3. Switching focus when you have too many projects

Indexing and tooling can slow down with dozens of submodules. You have two ways to change which projects are "active":

**Soft switch** - Toggle `.gitignore` so tooling skips projects you're not using. Add a path to deactivate, remove it to activate, reload the window. Your WIP stays local; no push, no commit. Use this when you just want to focus on 1–2 projects for a while.

```gitignore
# Soft-switch: project-a disabled, project-b active
project-a/
# project-b/
```

**Hard switch** - Remove one submodule and add another. The AI will prompt you to store progress (commit & push) before removing, so you never lose work. Use this when you want to permanently drop a project from the root and bring in a different one.

### 4. Or let the AI do it

I added a [`root-gitmodule-setup`](./.cursor/skills/root-gitmodule-setup/SKILL.md) skill that makes this trivial: ask your AI to "add a project", "remove a project", or "switch projects", and it walks you through the right steps - including asking whether you want soft or hard switch when it's unclear.

See [docs/project-setup.md](docs/project-setup.md) for the full guide.

## What's in the box

This repo contains AI agents, skills, and rules I used in other projects - development, scraping, packaging, releases, and more. They live in [`.cursor/skills/`](.cursor/skills/README.md). You can keep them, replace them, or fork the whole thing and make it yours.

The skills are tuned for **JavaScript/TypeScript projects using a pnpm monorepo**.

### Skill health metrics

Skills in this project emit health metrics when used.

You can open up a dashboard to see the health metrics.
See [docs/skill-usage-tracking/](docs/skill-usage-tracking/).

![Skill health metrics dashboard](./docs/skill-usage-tracking/skill-eval-dashboard.png)

### Agent and tool tracking

Hooks log subagent runs and tool invocations to `.cursor/logs/agents/` and `.cursor/logs/tools/`. A preview server (`scripts/preview/`) exposes `/agents` and `/tools` for inspecting runs, durations, and failures. See [docs/design-decisions/agent-tool-tracking/](docs/design-decisions/agent-tool-tracking/).

## Try it

Clone, add your first project, and open it in Cursor. One config. Many projects. No more copy-paste.

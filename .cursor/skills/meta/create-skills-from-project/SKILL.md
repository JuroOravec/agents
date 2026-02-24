---
name: meta-create-skills-from-project
description: Create skills from an existing project's patterns. Use when introducing an agent to a new project, onboarding to a codebase, or capturing recurring patterns so the agent won't ignore them.
---

# Create Skills From Project

When an agent is introduced to a new project, it often ignores already-existing patterns — leading to corrections and friction. This skill guides you to **discover project patterns and capture them as skills** before or during development, so the agent follows established conventions from the start.

Before creating skills, read `.cursor/skills/meta/skill-create/SKILL.md` for naming, structure, and directory conventions in this project.

**Example output:** For a full run (analysis → candidates → skills) on a real project, see [example-output-cbc-website.md](example-output-cbc-website.md).

## When to use

Trigger this skill when:

- Introducing an agent to a new project (e.g. a newly added nested clone).
- Onboarding to a codebase and you want to capture its patterns for future AI assistance.
- The agent repeatedly ignores existing patterns and you want to codify them.
- The user says "create skills from this project", "capture project patterns", or "onboard the agent to [project]".

## Prerequisites

- A target project in scope — either the current workspace or an imported project path (e.g. `cbc-website/`).
- Access to this skills repo (`.cursor/skills/`) for conventions and output location.
- The project has enough structure to infer patterns (src, package.json, tests, etc.).

## Workflow

**Format:** All skills MUST use `### Phase N: Title` for each workflow step. Enforced by validation script in CI.

**Skill-eval (meta-evaluation):** From the project root, run `./scripts/skill-eval.sh start {conversation_id} meta-create-skills-from-project` at workflow start (conversation_id is injected at session start—look for "Conversation ID (for skill-eval)" in context). Capture the printed `skill_id` from the terminal output. Preserve both `conversation_id` and `skill_id` for the duration—if context gets summarized, ensure these IDs are retained. After each phase (or when skipping a phase), run `./scripts/skill-eval.sh complete {skill_id} {phase_no}` or `./scripts/skill-eval.sh complete {skill_id} {phase_no} --skipped` from the project root.

Create todo tasks for each phase before proceeding.

### Phase 1: Identify target and scope

1. **Target project** — Which project? If this is a root repo with imported nested clones, specify the path (e.g. `cbc-website/`). If the workspace is the project itself, use `.`.
2. **Scope** — Confirm with the user: create skills for all discoverable areas, or focus on specific ones (e.g. only development, only content editing)?
3. **Skill prefix** — For project-specific patterns, prefer `project-{name}--{area}` or `act-dev--{name}-{action}` when the pattern fits a known prefix. Use `meta-skill-create` conventions.

### Phase 2: Explore and analyze

Explore the project and document patterns in these areas. Adjust based on what the project contains.

**Development**

- **Feature structure** — How are new features organized? (utils, lib, components, plugins, pages, routes, etc.) Where do new files go? What naming conventions exist?
- **Tests** — How are tests written? (Vitest, Jest, Playwright, etc.) Where do tests live? What patterns (describe/it, fixtures, mocks)?
- **Commands** — What scripts are in `package.json` (or equivalent)? Lint, validate, build, test, dev. Any custom tooling?
- **Data flow** — How does data move through the app? (state, props, fetch, API layer, content sources?)

**Other areas** (if present and relevant)

- **Content** — How is content stored and edited? (MDX, JSON, CMS, i18n?)
- **Styling** — CSS approach (Tailwind, CSS modules, design tokens)?
- **Deployment** — Build output, env vars, deploy targets?

For each area, produce a concise summary: pattern → skill candidate. If a pattern is trivial or one-off, skip it. Focus on patterns the agent is likely to violate without guidance.

### Phase 3: Draft skill candidates

For each significant pattern:

1. **Name** — Following `meta-skill-create`, pick prefix and specific (e.g. `project-cbc-website--content-edit`, `act-dev--cbc-feature-add`).
2. **Trigger** — When should this skill run? (e.g. "Use when adding a new course to the CBC site")
3. **Key instructions** — 3–8 bullet points or short paragraphs that capture the pattern. Be concrete (paths, commands, examples).

Avoid creating skills for things already covered by existing skills. Check `.cursor/skills/` first. Prefer **updating** an existing skill if the pattern extends it.

### Phase 4: Create skills

1. For each candidate, create `SKILL.md` under `.cursor/skills/{skill-name}/`.
2. Follow the structure in `meta-skill-create`: frontmatter, When to use, Workflow phases, Verification, Out of scope.
3. Add supporting `.md` files if a pattern needs detailed reference (e.g. `content-structure.md`).
4. Update `.cursor/skills/README.md` — add the skill to the catalog table and to the Common commands table if it has user-triggerable phrases.
5. If the skill should always apply when working on that project, consider `.cursor/rules/always-apply-skills.md` (or document that it’s project-scoped and loaded when editing that project).

### Phase 5: Verify

- [ ] Each new skill has correct frontmatter (`name`, `description`).
- [ ] Skills are discoverable (description includes trigger terms).
- [ ] README catalog is updated.
- [ ] No duplicate or overlapping skills for the same pattern.

## Verification

- [ ] Target project was explored in the key areas (development, tests, commands, data flow).
- [ ] Patterns were distilled into actionable skill content.
- [ ] Skills follow `meta-skill-create` conventions.
- [ ] New skills are added to `.cursor/skills/README.md` (catalog and Common commands table).

## Out of scope

- Creating skills from scratch without a project to analyze — see `create-skill` or `meta-skill-create`.
- Evaluating whether a pattern is worth a skill after a task — see `meta-discovery`.
- Managing the root repo or imported projects — see `root-project-setup`.

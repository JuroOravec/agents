---
name: meta-skill-create
description: Conventions for creating and organizing skills in this project. Use when creating, writing, updating, modifying, or changing a skill; renaming skills; or reviewing the skill directory structure. Prefer this skill over create-skill when the context is this project's skills.
---

# Skill Conventions

Guidelines for creating, naming, and organizing skills in `.cursor/skills/`.

## When to use

Trigger this skill when:

- Creating, writing, updating, or modifying a skill in this project.
- Reviewing or reorganizing the skill directory.
- Deciding what prefix a new skill should have.
- The user says "skill writing", "skill creation", "update the skill", or similar — this is the project's skill authoring guide; use it (not create-skill) for project skills.

## Naming conventions

See `.cursor/skills/README.md` for the full naming guide, including the
three-layer naming system (prefix, area, specific), the object-action
pattern, and the complete skill catalog.

The key points for creating a new skill:

- **Prefix** (`root-`, `act-`, `project-`, `meta-`) classifies when the skill runs.
  These rarely change.
- **Area** (e.g. `dev`, `repo`, `security`) groups skills by domain. This
  layer is optional -- only add it when there are enough skills that the
  grouping helps.
- **Specific** follows an object-action pattern (noun first, verb second).
  Omit the verb when there's only one meaningful action for the noun.
  Keep it when the noun alone would be ambiguous.

## Directory structure

Each skill lives in its own directory under `.cursor/skills/`:

```
.cursor/skills/
  meta-skill-create/             # This skill (conventions)
    SKILL.md
  project-setup/               # project- prefix: set-and-forget
    SKILL.md
    package-json.md            # Supporting resource files
    typescript-build.md
    ...
  act-security-vuln/           # act- prefix: reactive
    SKILL.md
```

### Required files

- **`SKILL.md`** -- the main skill file. This is what Cursor reads to understand the skill.

### Optional files

- **Supporting `.md` files** -- detailed references, templates, or guides that `SKILL.md` links to. Keep them in the same directory.

## SKILL.md structure

Every `SKILL.md` follows this structure:

```markdown
---
name: { skill-name }
description: { One-sentence description. Starts with a verb. Matches the Cursor skill description. }
---

# {Title}

{1-2 sentence overview of what this skill does and when it applies.}

## When to use

Trigger this skill when:

- {Condition 1}
- {Condition 2}
- ...

## Workflow

**Format:** All skills MUST use `### Phase N: Title` for each workflow step. Enforced by validation script in CI.

**Skill-eval (meta-evaluation):** From the project root, run `./scripts/skill-eval.sh start {conversation_id} {skill-name}` at workflow start (conversation_id is injected at session start—look for "Conversation ID (for skill-eval)" in context). Replace `{skill-name}` with the skill's directory name (e.g. `act-dev-coverage`). Capture the printed `skill_id` from the terminal output. Preserve both `conversation_id` and `skill_id` for the duration—if context gets summarized, ensure these IDs are retained. After each phase (or when skipping a phase), run `./scripts/skill-eval.sh complete {skill_id} {phase_no}` or `./scripts/skill-eval.sh complete {skill_id} {phase_no} --skipped` from the project root.

Create todo tasks for each phase before proceeding.

### Phase 0: Research (when skill addresses a specific topic)

Before executing, instruct the agent to research best practices and state-of-the-art for the given topic. Include this phase when the skill solves a domain-specific problem (e.g. data validation, scraper design, security disclosure). Skip or fold into Phase 1 for generic/meta skills.

### Phase 1: {Phase name}

{Instructions, templates, code blocks.}

### Phase 2: {Phase name}

...

## Verification

{Checklist to confirm the skill was applied correctly.}

## Out of scope

- {Thing this skill does NOT cover} -- see `{other-skill}` skill
```

### Conventions within SKILL.md

- **Frontmatter `name`** must match the directory name.
- **Frontmatter `description`** must match the description registered in Cursor's skill config (the `description` field in the skill's `available_skills` entry).
- **Phases** are numbered sequentially. Each phase is a discrete unit of work. Workflow MUST use `### Phase N: Title` for every step (e.g. `### Phase 1: Design`, `### Phase 2a: Soft switch`). Do not use `### 1. Step` or other formats. Enforced by CI.
- **Cross-references** to other skills use backtick-quoted names: ``see the `project-polish` skill``.
- **Verification** section uses a markdown checklist (`- [ ]`).
- **Out of scope** section lists related concerns handled by other skills, with cross-references.
- **Confirm before high-impact actions** — The skill should instruct the agent to confirm with the user before: carrying out substantial work, creating remote resources (e.g. GitHub issues, PRs), or deleting things. The skill can override this (e.g. "create issue without asking") when its design explicitly says so.
- **Research phase for topic-specific skills** — When the skill addresses a specific domain or topic, include a Phase 0 or early step instructing the agent to research best practices and state-of-the-art for that topic before executing the main workflow.

## Prefix reference

| Prefix     | Purpose                                                         |
| ---------- | --------------------------------------------------------------- |
| `root-`    | Managing this root repo itself (imported projects, config). Reserved for skills that configure the agents root, not imported projects. |
| `project-` | One-time setup of a project or major milestone.                  |
| `act-`     | Reactive, event-driven workflows (bugs, releases, PRs, etc.).   |
| `meta-`    | Self-referential: skills about skills, conventions, discovery.  |

## Naming checklist

When creating a new skill:

1. **If the skill is for a specific topic** — Research best practices and state-of-the-art for that domain before designing the workflow. Use web search or docs to avoid reinventing the wheel.
2. Decide the prefix: root-repo management (`root-`), one-time setup (`project-`), reactive (`act-`), or self-referential (`meta-`).
3. Decide whether an area grouping is needed (see naming conventions above).
4. Pick the specific name using object-action pattern. Omit the verb if unambiguous.
5. Check if this skill specializes an existing `act-{area}` skill. If yes, use `act-{area}--{object-action}`.
6. If the skill is experimental (value or shape still being validated), append `--exp` to the name. This signals it may be removed, reworked, or graduated into a stable skill later.
7. Create the directory and `SKILL.md`.
8. Register the skill in Cursor's skill config.
9. If the skill should always be active, add it to `.cursor/rules/always-apply-skills.md`.
10. Update `.cursor/skills/README.md` -- add the skill to the catalog table; add to the diagram if it has connections to other skills; **add to the Common commands table** (see "Common commands" section) if the skill has user-triggerable phrases.

## Verifying skills with tangible outputs

When a skill produces **artifacts** (e.g. an analysis markdown file) or **tangible outputs** (code changes):

1. **Verify in a fresh chat** — Ask the agent to carry out a representative task using the skill. Instruct it to place outputs inside the skill's directory.
2. **Output placement** — New files go in the skill directory (e.g. `act-dev--scraper-discovery/step3-analysis-example.md`). For code changes, capture before/after in a file under the skill directory.
3. **Link from SKILL.md** — Add a link to the example so users and the agent can see what "good" looks like.
4. **Iterate** — If the output is incomplete or wrong shape, refine the skill prompt and re-run verification until it meets expectations.

To make this easier, prepare a prompt that the user can copy-paste into the new chat to verify the skill works.
Example prompt for new chat:

```txt
Read up on the scraper discovery skill. Carry out step 3 analysis for profesia.sk,
using this as the brief @SKILL.md (67-69), and save it to `step3-analysis-profesia-sk.md`
next to the skill file.
```

Example: [`act-dev--scraper-discovery/step3-analysis-profesia-sk.md`](../act-dev--scraper-discovery/step3-analysis-profesia-sk.md) — Step 3 analysis artifact produced by the scraper-discovery skill.

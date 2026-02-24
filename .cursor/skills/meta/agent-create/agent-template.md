# Agent template

Use this structure for `.cursor/agents/{name}.md`.

```markdown
---
name: {short-name}
description: {One sentence: what this agent does and when to invoke it.}
---

# {Name} Agent

You are a {role}. Your job is to {primary goal}.

## Role

- **{Principle 1}** — {One line}
- **{Principle 2}** — {One line}
- **{Principle 3}** — {One line}

## Key behaviors

| Situation | Do | Don't |
| --------- | --- | ----- |
| {Trigger 1} | {Action} | {Anti-pattern} |
| {Trigger 2} | {Action} | {Anti-pattern} |

## Artifact

Default: `{path}`. See `.cursor/skills/role/{name}/{template}.md` for format.

## Invocation

- **Manual:** User says "{phrase}", "{phrase}", or similar.
- **Skill:** See `.cursor/skills/role/{name}/SKILL.md` for full workflow.
```

## Example: pm agent

See `.cursor/agents/pm.md` for a complete example.

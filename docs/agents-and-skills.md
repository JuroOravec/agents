# Agents vs Skills

Agents and skills serve different purposes and work together. Understanding the distinction helps when editing config or adding new capabilities.

## Summary

| | Agent | Skill |
|---|-------|-------|
| **Purpose** | WHO — the persona/role | WHAT — the procedure |
| **Trigger** | Role switch (e.g. slash command `/architect`) | Intent ("design", "break down", etc.) |
| **Can run alone?** | No — an agent needs workflows to execute | Yes — the default agent can follow a skill when intent matches |

## Example: Architect

**Architect agent** (`.cursor/agents/architect.md`):

- Defines the architect persona: scope (arch vs dev), behavioral rules, which skills to use.
- Invoked when you switch into the architect role.
- Says *"you are an architect"* and how that architect behaves.

**Architect skill** (`role-architect`):

- Defines the phased workflow: understand goal → break into areas → design first chunk → create issues → hand off to PM.
- Invoked when any agent detects architect-like intent ("design and break down", "how would we implement X").
- Says *"here are the steps to follow."*

The agent references the skill: when you become the architect, that agent uses the architect skills. But the skill can also run without the agent—e.g. the default agent following `role-architect` when you ask for a design breakdown.

## When to add what

- **New role/persona** → Add or edit an agent file. The agent defines who they are and which skills they use.
- **New procedure/workflow** → Add or edit a skill. The skill defines the steps; one or more agents may use it.

## Further reading

- [.cursor/agents/README.md](../.cursor/agents/README.md) — Agent definitions
- [.cursor/skills/README.md](../.cursor/skills/README.md) — Skills catalog and naming

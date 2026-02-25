# Scripts

## validate

Validation runner (same pattern as crawlee-one). Runs all scripts in `scripts/validate/`. Each script exports a default async function; any throw causes exit 1.

```bash
pnpm run validate
```

**Scripts:**
- `skill-phases.ts` — Validates `### Phase N: Title` format in `.cursor/skills/*/SKILL.md`

## skill-eval

CLI for meta-evaluation skill-adherence tracking. Design: `docs/design-decisions/meta-skill-evaluation/`.

**Usage:**

```bash
# Start a skill run (pass conversation_id from context; script prints skill_id)
./scripts/skill-eval.sh start <conversation_id> <skill_name>

# Record completed phase
./scripts/skill-eval.sh complete <skill_id> <phase_no>

# Record skipped phase
./scripts/skill-eval.sh complete <skill_id> <phase_no> --skipped
```

**Example:**

```bash
$ ./scripts/skill-eval.sh start "abc-conversation-uuid" "act-repo-issue-create"
72284f1e-382b-4fa7-8035-bf91e3a2263e

$ ./scripts/skill-eval.sh complete 72284f1e-382b-4fa7-8035-bf91e3a2263e 1
$ ./scripts/skill-eval.sh complete 72284f1e-382b-4fa7-8035-bf91e3a2263e 2 --skipped
```

Output: `.cursor/logs/skills/{timestamp}_{skill}_{skill_id}.json`

## crews

AI crews (KaibanJS). See `scripts/crews/README.md`.

## preview

Local dashboard for skill-eval, agent, and tool logs. Design: `docs/design-decisions/agent-tool-tracking/`.

```bash
pnpm run preview
```

Serves at `http://localhost:3040` (configurable via `-p`):

- **/skills** — Heatmap (skill × phase) + line chart (success over time)
- **/agents** — Subagent runs from `.cursor/logs/agents/*.jsonl` (subagentStop hook)
- **/tools** — Tool invocations from `.cursor/logs/tools/*.jsonl` (postToolUse, postToolUseFailure hooks)

Agents and Tools pages support filter (JS expression), sort (click headers), and pagination (100 per page).

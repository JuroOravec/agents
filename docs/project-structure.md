# Project Structure

This project uses a Mastra-inspired layout with application code under `src/`.

```
agents/
├── .cursor/              # Rules, skills, agents, hooks, logs
├── docs/
├── specs/                 # Agent specs and spec tests
├── src/
│   ├── mastra/            # Mastra instance and workflows
│   │   ├── patterns/      # fanOut, pipe, orchestrator, etc.
│   │   ├── workflows/
│   │   │   └── prd-review.ts
│   │   ├── agents/
│   │   │   ├── worker.ts   # Worker agent (used by worker crew)
│   │   │   └── reviewer.ts # Reviewer agent (used by worker crew)
│   │   ├── tools/         # (optional, for future use)
│   │   └── index.ts       # Central Mastra instance
│   ├── crews/             # Crew orchestration (worker, prd-review)
│   │   ├── utils/
│   │   ├── worker.ts
│   │   ├── worker.ts
│   │   ├── reviewer.ts
│   │   ├── prd-review.ts  # Thin wrapper around mastra workflow
│   │   └── config.ts
│   ├── preview/           # Skill-eval dashboard server
│   ├── engine/            # Check runner + validation scripts
│   │   ├── index.ts       # Phases: types, lint, format, test, validate
│   │   └── validate/      # Custom constraint scripts
│   └── index.ts           # Library entry
├── scripts/               # Thin launchers
│   ├── preview.ts
│   ├── validate.ts
│   ├── check.ts
│   ├── demo-worker.ts
│   ├── demo-prd-review.ts
│   └── skill-eval.sh
├── package.json
└── ...
```

## Commands

| Script                 | Launcher                       | Description                        |
| ---------------------- | ------------------------------ | ---------------------------------- |
| `pnpm preview`         | `scripts/preview.ts`           | Skill-eval dashboard               |
| `pnpm validate`        | `src/engine/validate/index.ts` | Custom constraints                 |
| `pnpm check`           | `scripts/check.ts`             | Full validation engine             |
| `pnpm demo-worker`     | `scripts/demo-worker.ts`       | AI Software Factory iteration loop |
| `pnpm demo-prd-review` | `scripts/demo-prd-review.ts`   | PRD Review Committee               |

## validate

Runs all scripts in `src/engine/validate/`. Each script exports a default async function; any throw causes exit 1.

- `skill-phases.ts` — Validates `### Phase N: Title` format in `.cursor/skills/*/SKILL.md`
- `prevent-spec-modifications.ts` — Blocks agent branches from modifying `specs/`
- etc.

## preview

Local dashboard for skill-eval, agent, and tool logs.

```bash
pnpm run preview
```

Serves at `http://localhost:3040` (-p for custom port):

- **/skills** — Heatmap (skill × phase) + line chart
- **/agents** — Subagent runs
- **/tools** — Tool invocations
- **/prompts** — User prompts
- **/chats** — Chat sessions

## crews

AI crews (Mastra). See `src/crews/README.md` and `docs/features/ai-crews/`.

## skill-eval

CLI for meta-evaluation skill-adherence tracking. Design: `specs/meta-skill-evaluation/`.

```bash
./scripts/skill-eval.sh start <conversation_id> <skill_name>
./scripts/skill-eval.sh complete <skill_id> <phase_no> [--skipped]
```

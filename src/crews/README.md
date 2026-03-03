# Crews

AI crews (Mastra). Model tiers and keys in `src/models.ts`.

**Pattern library:** Reusable multi-agent collaboration patterns live in `src/mastra/patterns/`. See [docs/features/ai-crews/patterns.md](../../docs/features/ai-crews/patterns.md) for the catalog (fan-out, round robin, evaluator-optimizer, etc.).

| Env                                                     | Purpose                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `CREW_MODEL_SMART`, `CREW_MODEL_FAST`                   | `provider:model` (e.g. `openai:gpt-5`)                                                 |
| `CREW_MODEL_SMART_API_KEY`, `CREW_MODEL_FAST_API_KEY`   | Optional overrides; else `OPENAI_API_KEY` etc. per provider                            |
| `CREW_MODEL_SMART_BASE_URL`, `CREW_MODEL_FAST_BASE_URL` | Custom endpoint (e.g. OpenRouter). See [docs/openrouter.md](../../docs/openrouter.md). |

**Cursor CLI:** Set `CREW_MODEL_SMART=cursor:composer-1-5` to run crews via local Cursor Agent CLI. See [src/llm-providers/cursor/cursor-provider.ts](../llm-providers/cursor/cursor-provider.ts).

## demo-worker

AI Software Factory Iteration Loop — Reviewer + Worker collaborate in a git worktree until APPROVED. Interactive by default; use `--no-interactive` for single-run.

```bash
pnpm run demo-worker -- --goal "Fix the math function in src/math.ts"
```

## demo-prd-review

PRD Review Committee — Architect, PM, Security, User Advocate (parallel) scrutinize a PRD; synthesizer produces refined PRD and outstanding questions. Writes result to the output path.

```bash
pnpm run demo-prd-review <input-path> <output-path>
pnpm run demo-prd-review --demo <output-path>   # use DEMO_PRD as input (example format)
```

Requires `OPENAI_API_KEY` (or `CREW_MODEL_*_API_KEY` overrides) in the environment.

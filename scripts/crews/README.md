# Crews

AI crews (KaibanJS). Model tiers and keys in `config.ts`.

| Env | Purpose |
| --- | ------- |
| `CREW_MODEL_SMART`, `CREW_MODEL_FAST` | `provider:model` (e.g. `openai:gpt-5`) |
| `CREW_MODEL_SMART_API_KEY`, `CREW_MODEL_FAST_API_KEY` | Optional overrides; else `OPENAI_API_KEY` etc. per provider |
| `CREW_MODEL_SMART_BASE_URL`, `CREW_MODEL_FAST_BASE_URL` | Custom endpoint (e.g. OpenRouter). See [docs/openrouter.md](../../docs/openrouter.md). |

**Cursor CLI:** Set `CREW_MODEL_SMART=cursor:composer-1-5` to run crews via local Cursor Agent CLI. The `crew-prd-review-cursor` script is an alias for this. See [utils/cursor.ts](./utils/cursor.ts).

## crew-prd-review

PRD Review Committee — Architect, PM, Security, User Advocate scrutinize a PRD; synthesizer produces refined PRD and outstanding questions. Writes result to the output path.

```bash
pnpm run crew-prd-review <input-path> <output-path>
pnpm run crew-prd-review --demo <output-path>   # use DEMO_PRD as input (example format)
```

Requires `OPENAI_API_KEY` (or `CREW_MODEL_*_API_KEY` overrides) in the environment.

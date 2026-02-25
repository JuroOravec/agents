---
name: act-ai-crew-run
description: Run an existing AI crew/committee workflow. Use when the user wants to execute a KaibanJS crew, pass inputs, or invoke a crew script (e.g. prd-review).
---

# Run AI Crew

Workflow for executing an existing AI crew — passing inputs, handling output, and troubleshooting.

This skill complements `act-ai-crew-create`: that skill creates crews; this skill runs them.

**Example:** See [ai_crew_usage_example.md](./ai_crew_usage_example.md) for a real conversation where the PRD review committee was invoked on a design document (spec-first PRD diff). The committee ran via OpenRouter and wrote structured output to a markdown file.

## When to use

Trigger this skill when:

- The user wants to run a crew (e.g. "run the PRD review", "execute prd-review").
- The user asks how to pass inputs to a crew or invoke it from the CLI.
- The user has an existing crew script and needs to run it with specific input.

## Workflow

**Format:** All skills MUST use `### Phase N: Title` for each workflow step. Enforced by validation script in CI.

**Skill-eval (meta-evaluation):** From the project root, run `./scripts/skill-eval.sh start {conversation_id} act-ai-crew-run` at workflow start (conversation_id is injected at session start—look for "Conversation ID (for skill-eval)" in context). Capture the printed `skill_id` from the terminal output. Preserve both `conversation_id` and `skill_id` for the duration. After each phase (or when skipping a phase), run `./scripts/skill-eval.sh complete {skill_id} {phase_no}` or `./scripts/skill-eval.sh complete {skill_id} {phase_no} --skipped` from the project root.

### Phase 1: Identify crew and paths

Determine which crew script to run, the input path, and the output path. For prd-review: `input-path` and `output-path` are required; use `--demo` to substitute the example PRD as input. Ensure `OPENAI_API_KEY` (or provider-specific key) is set.

### Phase 2: Invoke the crew

Run the crew via pnpm script (e.g. `pnpm run crew-prd-review input.md output.md`) or programmatically via `runPrdReview({ inputPath, outputPath, demo? })`. See [Input passing](#input-passing) below.

### Phase 3: Handle output

Crews typically write to the output path. Report the written file and any stats to the user.

## Input passing

### 1. Via pnpm script

Most crews live in `scripts/crews/` and are invoked via a pnpm script. PRD review uses required input and output paths:

```bash
pnpm run crew-prd-review <input-path> <output-path>
pnpm run crew-prd-review --demo <output-path>   # use DEMO_PRD (example format) as input
```

### 2. Input/output model

| Crew | Input | Output |
| ---- | ----- | ------ |
| crew-prd-review | Input path (PRD file) or `--demo` | Output path (writes refined PRD + outstanding questions) |

### 3. Programmatic invocation

When invoking from another script or API:

```typescript
import { runPrdReview } from "./scripts/crews/prd-review.js";

const result = await runPrdReview({
  inputPath: "docs/draft-prd.md",
  outputPath: "docs/refined-prd.md",
});
// Or with --demo equivalent:
await runPrdReview({ inputPath: "", outputPath: "out.md", demo: true });
```

### 4. Environment variables

Crews need LLM API keys. Pass via environment:

```bash
OPENAI_API_KEY=sk-... pnpm run crew-prd-review
# or
export OPENAI_API_KEY=sk-...
pnpm run crew-prd-review
```

The crew's `env: process.env` ensures the Team receives these. Supported keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `MISTRAL_API_KEY`. Optional overrides: `CREW_MODEL_SMART_API_KEY`, `CREW_MODEL_FAST_API_KEY` (see `scripts/crews/config.ts`).

## Output handling

- **Structured output:** When the final task has `outputSchema` (Zod), `output.result` is the parsed object.
- **Raw output:** Otherwise `output.result` may be a string.
- **Status:** Check `output.status` — `FINISHED`, `BLOCKED`, or error (rejected promise).
- **Stats:** `output.stats` includes `duration`, `llmUsageStats` (tokens), `costDetails`.

## Common commands

| Intent | Command |
| ------ | ------- |
| Run PRD review | `pnpm run crew-prd-review draft.md refined.md` |
| Run with demo input | `pnpm run crew-prd-review --demo refined.md` |
| Run via Cursor CLI (no API key) | `CREW_MODEL_SMART=cursor:composer-1-5 pnpm run crew-prd-review --demo out.md` |

## Verification

- [ ] Input and output paths specified (or --demo for prd-review)
- [ ] API key set (`OPENAI_API_KEY` or provider-specific)
- [ ] Crew script exists under `scripts/` and is registered in package.json
- [ ] Output status checked (FINISHED vs error)
- [ ] Result interpreted correctly (structured vs raw)

## Out of scope

- Creating new crews — see `act-ai-crew-create` skill
- Modifying crew logic or agents — treat as code change, then run
- Production deployment (async jobs, webhooks) — see [crew_ai.md](../../../../docs/features/ai-crews/crew_ai.md) advanced sections

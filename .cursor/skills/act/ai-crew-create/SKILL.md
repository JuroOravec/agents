---
name: act-ai-crew-create
description: Create an AI crew/committee workflow in KaibanJS. Use when the user wants to assemble a virtual team of AI agents to review, analyze, or synthesize documents from multiple expert perspectives.
---

# Create AI Crew Workflow

End-to-end workflow for designing and implementing a role-based multi-agent crew (CrewAI-style) in KaibanJS. Assembles a virtual committee of AI agents that pool perspectives and produce structured output.

This skill is part of the `act-ai-*` area: tasks that invoke AI/LLM-based workflows.

## When to use

Trigger this skill when:

- The user wants to create a "committee" or "crew" of AI agents to review a document.
- The user asks for a multi-agent workflow to pool expert perspectives (e.g. PRD review, code review, compliance check).
- The user references "CrewAI", "KaibanJS", or "AI committee" and wants to implement something similar.

## Workflow

**Format:** All skills MUST use `### Phase N: Title` for each workflow step. Enforced by validation script in CI.

**Skill-eval (meta-evaluation):** From the project root, run `./scripts/skill-eval.sh start {conversation_id} act-ai-crew-create` at workflow start (conversation_id is injected at session start—look for "Conversation ID (for skill-eval)" in context). Capture the printed `skill_id` from the terminal output. Preserve both `conversation_id` and `skill_id` for the duration—if context gets summarized, ensure these IDs are retained. After each phase (or when skipping a phase), run `./scripts/skill-eval.sh complete {skill_id} {phase_no}` or `./scripts/skill-eval.sh complete {skill_id} {phase_no} --skipped` from the project root.

Create todo tasks for each phase before proceeding.

### Phase 1: Gather context

Determine what committee we are creating and for what task.

1. **Check for existing context.** The user or calling agent may have already specified:
   - Committee purpose (e.g. "PRD review", "code review", "security audit").
   - Input artifact type (PRD, RFC, code, etc.).
   - Desired output (refined document, findings list, approval status, etc.).

2. **If context is missing or incomplete**, ask the user or agent that invoked you:
   - "What document or artifact will this committee review?"
   - "What perspectives or expertise should the committee represent?"
   - "What form should the final output take (refined document, structured report, list of issues)?"

3. **Summarize the gathered context** in a brief spec (1-2 paragraphs) and confirm with the user before proceeding.

### Phase 2: Define crew strategy

Choose the coordination pattern and define how inputs and outputs flow.

1. **Select a pattern** from [crew_ai.md](../../../../docs/features/ai-crews/crew_ai.md):

   | Pattern | Best for | Flow |
   | ------- | -------- | ---- |
   | **Evaluator-Optimizer (Actor-Critic)** | One agent creates, another validates. Loop until pass. | Generator → Evaluator (retry loop) → output |
   | **Parallel Panel (Map-Reduce)** | Multiple agents review same artifact concurrently. | Router → [Agent A, Agent B, Agent C] (parallel) → Synthesizer |
   | **Sequential Conference Room** | Multiple perspectives, one at a time, then synthesize. | Agent 1 → Agent 2 → … → Synthesizer (single flow) |

2. **Define input/output contracts:**
   - **Inputs:** What variables will be passed to `team.start()`? (e.g. `{ prd_document: string }`, `{ code: string }`).
   - **Task result passing:** Which tasks reference previous results via `{taskResult:taskN}`?
   - **Final output schema:** Zod schema for the last task's structured output (e.g. `{ updated_prd_content, outstanding_questions }`).

3. **Document the flow** as a simple diagram or bullet list and confirm with the user.

### Phase 3: Define agents

Specify the exact collection of agents, their roles, backgrounds, goals, and model selection.

1. **List agents** with:
   - **Name** (friendly identifier).
   - **Role** (e.g. "Principal Software Architect", "Lead Security Analyst").
   - **Goal** (one-sentence objective).
   - **Background** (2-3 sentences; persona, expertise, temperament).

2. **Assign models (fast vs thinking):**
   - **Heavy/thinking models** (`gpt-5`, `claude-sonnet-4`): Complex reasoning, synthesis, security, architecture.
   - **Fast/cheap models** (`gpt-5-mini`, `claude-3-haiku`): Simpler validation, formatting, routing.

3. **Assign tasks to agents:** Which agent executes each task? Note any agent that leads multiple tasks or synthesizes final output.

4. **Record the agent spec** and confirm with the user.

### Phase 4: Generate KaibanJS code

Convert the spec into TypeScript and write it to `scripts/crews/` (or another location if explicitly specified). Each crew is a single file that defines the team and includes the runner logic.

1. **Ensure `scripts/crews/config.ts` exists** (if not, create it). It exports `smartLlm` and `fastLlm` — `{ provider, model }` objects for capability tiers. Override via `CREW_MODEL_SMART` and `CREW_MODEL_FAST` env vars (`provider:model` format). See [crew_ai.md](../../../../docs/features/ai-crews/crew_ai.md) for the registry pattern.

2. **Create the crew script** (e.g. `scripts/crews/{name}.ts`):
   - Import `smartLlm`, `fastLlm` from `./config.js` for agent `llmConfig`.
   - Define the Zod output schema, Agents, Tasks, Team (same structure as template below).
   - Append runner logic: required `inputPath` and `outputPath` args; optional `--demo` to use a built-in example (DEMO_*).
   - Export `runXxx({ inputPath, outputPath, demo? })` for programmatic use.
   - Use `{variable_name}` for input placeholders and `{taskResult:taskN}` for prior task results.

3. **Add a pnpm script** in `package.json` with `crew-` prefix (e.g. `"crew-prd-review": "tsx scripts/crews/prd-review.ts"`).

4. **Ensure dependencies:** `kaibanjs` and `zod` in `package.json` (or project deps).

**Reference implementation:** `scripts/crews/prd-review.ts` — a full PRD Review Committee (crew + runner in one file). `scripts/crews/config.ts` — central model registry.

**Code template (scripts/crews/{name}.ts):**

```typescript
#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { Agent, Task, Team } from "kaibanjs";
import { fastLlm, smartLlm } from "./config.js";

const OutputSchema = z.object({ /* fields */ });
type Output = z.infer<typeof OutputSchema>;

const agent1 = new Agent({ name, role, goal, background, llmConfig: smartLlm });
const agent2 = new Agent({ name, role, goal, background, llmConfig: fastLlm });

const task1 = new Task({ description: "…{input_var}…", expectedOutput: "…", agent: agent1 });
const task2 = new Task({ description: "…{taskResult:task1}…", expectedOutput: "…", agent: agent2, outputSchema: OutputSchema });

const team = new Team({ name, agents: [agent1, agent2], tasks: [task1, task2], memory: true, env: process.env });

export const DEMO_INPUT = "…";  // example format for --demo

export async function runXxx(opts: { inputPath: string; outputPath: string; demo?: boolean }): Promise<Output> {
  const input = opts.demo ? DEMO_INPUT : await readFile(opts.inputPath, "utf-8");
  const output = await team.start({ input_var: input });
  if (output.status !== "FINISHED") throw new Error(output.status);
  const result = output.result as Output;
  await writeFile(opts.outputPath, /* format result */, "utf-8");
  return result;
}
```

### Phase 5: Verify and document

1. Add a brief entry to `scripts/crews/README.md` describing the new crew and usage.
2. Confirm the script runs (with a small input or default) if the user has API keys configured.
3. Present the created files and usage to the user.

## Verification

- [ ] Context gathered and spec confirmed (committee purpose, input/output)
- [ ] Crew strategy chosen (pattern from [crew_ai.md](../../../../docs/features/ai-crews/crew_ai.md)) and flow documented
- [ ] Agents defined (roles, goals, backgrounds, model assignment)
- [ ] KaibanJS code generated in `scripts/crews/` (single file or config + crew)
- [ ] pnpm script added to package.json
- [ ] scripts/crews/README.md updated
- [ ] User has reviewed and can run the crew

## Out of scope

- Running existing crews — see `act-ai-crew-run` skill
- Observability, Portkey, or production deployment patterns — see [crew_ai.md](../../../../docs/features/ai-crews/crew_ai.md) for advanced sections
- LangGraph or Python CrewAI — this skill targets KaibanJS (TypeScript) only

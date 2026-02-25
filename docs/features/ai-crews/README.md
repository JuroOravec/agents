# How to Run Multi-Agent AI Crews in Your Project

**Get an Architect, a PM, a Security Analyst, and a User Advocate to review your docs — in one command.**

---

You’ve drafted a PRD, a design doc, or a spec. You want it reviewed from multiple angles: technical feasibility, scope realism, security, and user value. Doing that alone means switching hats, rereading the same text, and hoping you don’t miss something. A better option? Assemble a small committee of AI agents—each with a defined role—and have them debate and refine the document for you.

This guide walks you through running **AI crews** in this project: what they are, how to run your first one, and how to tweak models and API keys to fit your setup.

---

## What you’ll get

- **PRD Review Committee** — Architect, PM, Security Analyst, End User Advocate, and Tech Writer review a product doc and output a refined version plus a list of outstanding questions.
- **Single command** — `pnpm run crew-prd-review input.md output.md`; results appear in the output file.
- **Model choice** — Use OpenAI, Anthropic, OpenRouter, or your local Cursor CLI (no API keys).
- **Structured output** — Refined markdown plus JSON-safe data; no messy chat logs.

---

## Why this matters

Crews encode a specific workflow: *multiple personas review the same artifact and synthesize*. That’s different from a single chatbot. Each agent has a goal and background (e.g. “You are a paranoid security expert”). They don’t chat endlessly—they follow tasks, produce structured output, and the framework orchestrates the flow. You get a reviewed document and a list of questions that need human input, not a raw conversation.

---

## Prerequisites

- **Node.js** and **pnpm** (this project uses pnpm workspaces)
- **An LLM API key** (OpenAI, Anthropic, etc.) or **Cursor Agent CLI** if you prefer to use your Cursor subscription
- This repo cloned and `pnpm install` run at the root

---

## Step 1: Choose your LLM backend

You need an LLM to power the agents. Pick one:

### Option A: OpenAI or Anthropic (API keys)

Create a `.env` in the project root:

```bash
# .env
OPENAI_API_KEY=sk-your-key-here
# or
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

The crew’s config loads `.env` automatically. Default models are `gpt-5` (smart) and `gpt-5-mini` (fast) for OpenAI; you can override via env (see Step 4).

### Option B: OpenRouter (one key, many models)

OpenRouter gives you access to multiple providers with a single API key. See [docs/openrouter.md](../../openrouter.md) for setup. Example:

```bash
CREW_MODEL_SMART_BASE_URL=https://openrouter.ai/api/v1
CREW_MODEL_FAST_BASE_URL=https://openrouter.ai/api/v1
CREW_MODEL_SMART=anthropic/claude-sonnet-4-6
CREW_MODEL_FAST=anthropic/claude-sonnet-4-6
CREW_MODEL_SMART_API_KEY=sk-or-v1-your-openrouter-key
CREW_MODEL_FAST_API_KEY=sk-or-v1-your-openrouter-key
```

### Option C: Cursor CLI (no API key)

If you use Cursor and have the Agent CLI installed:

```bash
curl https://cursor.com/install -fsS | bash
cursor-agent login
```

Then run crews with:

```bash
CREW_MODEL_SMART=cursor:composer-1-5 pnpm run crew-prd-review --demo output.md
```

Your Cursor subscription is used; no separate API key.

---

## Step 2: Run your first crew

With keys or Cursor set up, run the PRD Review Committee:

```bash
pnpm run crew-prd-review draft-prd.md refined-prd.md
```

The crew will:
1. Read `draft-prd.md`
2. Have the Architect, PM, Security, and User Advocate review it
3. Have the Tech Writer synthesize their feedback into a refined PRD
4. Write the result to `refined-prd.md`

Don’t have a draft yet? Use the built-in demo PRD:

```bash
pnpm run crew-prd-review --demo output.md
```

That uses an example document so you can see the flow end-to-end.

---

## Step 3: Interpret the output

When the crew finishes, you’ll see something like:

```
Wrote: refined-prd.md
  - Refined PRD: 12900 chars
  - Outstanding questions: 12
```

- **Refined PRD** — The improved document with critiques folded in.
- **Outstanding questions** — Items the committee couldn’t resolve (budget, compliance, third-party limits, etc.). These need human decisions.

If the run fails (e.g. `BLOCKED` or an error), check:
- API key is set and valid
- Model names match your provider (e.g. `anthropic/claude-sonnet-4` for OpenRouter)
- For Cursor CLI: `cursor-agent status` and workspace trust (`--trust` is passed by default for headless runs)

---

## Step 4: Customize models and limits

Env variables override defaults:

| Variable | Purpose |
| -------- | ------- |
| `CREW_MODEL_SMART` | Model for “smart” agents (e.g. `openai:gpt-5`, `anthropic:claude-sonnet-4`) |
| `CREW_MODEL_FAST` | Model for “fast” agents |
| `CREW_MODEL_SMART_API_KEY`, `CREW_MODEL_FAST_API_KEY` | Override API keys per tier |
| `CREW_MODEL_SMART_BASE_URL`, `CREW_MODEL_FAST_BASE_URL` | Custom endpoint (OpenRouter, Modal, vLLM) |
| `CREW_MAX_TOKENS` | Cap output tokens (useful for OpenRouter credits) |
| `CREW_TIMEOUT_MS` | Timeout in ms for slow or cold-start endpoints |

Example: cap tokens to stay within OpenRouter credits:

```bash
CREW_MAX_TOKENS=2048 pnpm run crew-prd-review draft.md refined.md
```

---

## What’s next

- **Run more crews** — Ask your AI assistant to “run PRD review” or “execute crew”; the `act-ai-crew-run` skill handles it.
- **Create new crews** — Use `act-ai-crew-create` to define new committees or workflows.
- **See a real example** — [ai_crew_usage_example.md](../../../.cursor/skills/act/ai-crew-run/ai_crew_usage_example.md) shows a full run on a spec-first PRD design doc.

**Deep dive:** [crew_ai.md](./crew_ai.md) — Headless multi-agent coordination patterns, CrewAI vs LangGraph, model routing, cost tracking, and production deployment (conversation transcript).

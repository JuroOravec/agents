# Using OpenRouter with AI Crews

This guide explains how to route crew workflows (e.g. PRD Review) through [OpenRouter](https://openrouter.ai) to access many models (Claude, GPT, Gemini, etc.) via a single API.

## Overview

**OpenRouter** is an API gateway that proxies requests to multiple LLM providers. You pay OpenRouter; they handle provider billing. Benefits:

- **Single API key** for dozens of models
- **Unified interface** — OpenAI-compatible API
- **Flexible model choice** — switch models by changing env vars

## Prerequisites

- [OpenRouter account](https://openrouter.ai)
- **Balance** — Add credits at [Settings → Keys](https://openrouter.ai/settings/keys). Without sufficient balance, you'll get `402` errors.

## Configuration

Add these to your `.env` file:

```env
# OpenRouter API key (get from https://openrouter.ai/keys)
CREW_MODEL_SMART_API_KEY=sk-or-v1-your-key-here
CREW_MODEL_FAST_API_KEY=sk-or-v1-your-key-here

# OpenRouter base URL (required for routing through OpenRouter)
CREW_MODEL_SMART_BASE_URL=https://openrouter.ai/api/v1
CREW_MODEL_FAST_BASE_URL=https://openrouter.ai/api/v1

# Models: use "provider/model" format (e.g. anthropic/claude-sonnet-4-6)
# You can also use "provider:model" in env — it's auto-converted to the slash format
CREW_MODEL_SMART=anthropic/claude-sonnet-4-6
CREW_MODEL_FAST=anthropic/claude-sonnet-4-6
```

### Environment Variables Reference

| Variable                    | Required | Description                                                                 |
| --------------------------- | -------- | --------------------------------------------------------------------------- |
| `CREW_MODEL_SMART_BASE_URL` | Yes      | `https://openrouter.ai/api/v1`                                               |
| `CREW_MODEL_FAST_BASE_URL`  | Yes      | `https://openrouter.ai/api/v1`                                              |
| `CREW_MODEL_SMART_API_KEY`  | Yes      | Your OpenRouter API key                                                     |
| `CREW_MODEL_FAST_API_KEY`   | Yes      | Your OpenRouter API key (can be same as smart)                               |
| `CREW_MODEL_SMART`          | Optional | Model ID, e.g. `anthropic/claude-sonnet-4-6` or `openai/gpt-5`             |
| `CREW_MODEL_FAST`           | Optional | Model ID, e.g. `anthropic/claude-sonnet-4-6` or `openai/gpt-5-mini`         |
| `CREW_MAX_TOKENS`           | Optional | Cap output tokens (e.g. `2048`) to stay within budget; omit for default     |

### Model Format

OpenRouter uses the `provider/model` format. In `.env` you can use either:

- `anthropic/claude-sonnet-4-6` (slash) — used as-is
- `anthropic:claude-sonnet-4-6` (colon) — auto-converted to slash

Browse models at [openrouter.ai/models](https://openrouter.ai/models).

## Running the Crew

With `.env` configured, run the PRD review:

```bash
pnpm run crew-prd-review --demo output.md
```

Or with a real PRD file:

```bash
pnpm run crew-prd-review path/to/prd.md path/to/output.md
```

You can override models via the command line (values still go through OpenRouter if base URLs are set):

```bash
CREW_MODEL_SMART=openai/gpt-5 CREW_MODEL_FAST=openai/gpt-5-mini pnpm run crew-prd-review --demo output.md
```

## Billing and Credits

- **Add credits** at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)
- **Pricing** — OpenRouter charges per token; you pay them, not the underlying provider. See [openrouter.ai/docs/pricing](https://openrouter.ai/docs/pricing)
- **402 errors** — "This request requires more credits" means your balance is too low. Either add credits or set `CREW_MAX_TOKENS=2048` (or lower) to cap output size

## Optional: Limit Token Usage

If you hit 402 errors with limited credits, add to `.env`:

```env
CREW_MAX_TOKENS=2048
```

This caps the model's output tokens per turn, reducing cost. ~2048 tokens ≈ 1.5k words of output.

## See Also

- [scripts/crews/README.md](../scripts/crews/README.md) — Crew commands and usage
- [scripts/crews/config.ts](../scripts/crews/config.ts) — Model registry and env parsing
- [OpenRouter Models](https://openrouter.ai/models) — Full model list and pricing

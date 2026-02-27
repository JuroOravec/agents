/**
 * Central registry where LLM models are defined.
 *
 * Model tiers — override via env:
 *   CREW_MODEL_GENIUS  = "provider:model"  — frontier reasoning, may not follow code conventions
 *   CREW_MODEL_SMART   = "provider:model"  — complex reasoning (Reviewer, Architect)
 *   CREW_MODEL_CODER   = "provider:model"  — optimized for reading/writing code (Worker sidecar)
 *   CREW_MODEL_FAST    = "provider:model"  — fast general tasks (PM, User Advocate)
 *   CREW_MODEL_MINI    = "provider:model"  — smallest/cheapest, for trivial tasks (title summarization)
 *   cursor:composer-1-5 = use Cursor CLI for all agents
 *
 * Custom base URL — for OpenAI-compatible proxies (OpenRouter, Modal, vLLM):
 *   CREW_MODEL_SMART_BASE_URL, CREW_MODEL_FAST_BASE_URL,
 *   CREW_MODEL_GENIUS_BASE_URL, CREW_MODEL_CODER_BASE_URL, CREW_MODEL_MINI_BASE_URL
 *   (all fall back to CREW_MODEL_SMART_BASE_URL, then https://openrouter.ai/api/v1)
 *
 * Token cap — for OpenRouter/limited credits:
 *   CREW_MAX_TOKENS  → e.g. 2048
 *
 * Timeout — for slow/cold-start endpoints:
 *   CREW_TIMEOUT_MS  → e.g. 180000 (3 min)
 *
 * API keys — optional overrides per tier (all fall back to CREW_MODEL_SMART_API_KEY):
 *   CREW_MODEL_SMART_API_KEY, CREW_MODEL_FAST_API_KEY,
 *   CREW_MODEL_GENIUS_API_KEY, CREW_MODEL_CODER_API_KEY, CREW_MODEL_MINI_API_KEY
 *
 * See docs/features/ai-crews/crew_ai.md.
 */

import 'dotenv/config';

import { createOpenAI } from '@ai-sdk/openai';

import { cursorCLI } from './llm-providers/cursor/cursor-provider.js';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

function isCursor(envVar: string): boolean {
  const raw = process.env[envVar]?.trim();
  return raw === 'cursor:composer-1-5' || raw === 'cursor/composer-1-5';
}

function getModelId(envVar: string, defaultId: string): string {
  const val = process.env[envVar]?.trim();
  if (!val || val.startsWith('cursor:')) return defaultId;
  // Convert provider:model → provider/model for OpenRouter compatibility
  return val.replace(':', '/');
}

function makeProvider(baseUrlVar: string, apiKeyVar: string) {
  return createOpenAI({
    baseURL: process.env[baseUrlVar] || process.env.CREW_MODEL_SMART_BASE_URL || DEFAULT_BASE_URL,
    apiKey: process.env[apiKeyVar] || process.env.CREW_MODEL_SMART_API_KEY,
  });
}

// .chat() uses the standard Chat Completions endpoint (/v1/chat/completions),
// which is the only endpoint OpenRouter (and most compatible proxies) support.
// The default provider() call uses the Responses API, which OpenRouter does not implement.

/**
 * Genius-tier model — frontier reasoning capability.
 * May not follow coding conventions well; best for high-level analysis, design, strategy.
 */
export const geniusModel = isCursor('CREW_MODEL_GENIUS')
  ? cursorCLI('composer-1.5', { mode: 'agent', timeoutMs: 120_000 })
  : makeProvider('CREW_MODEL_GENIUS_BASE_URL', 'CREW_MODEL_GENIUS_API_KEY').chat(
      getModelId('CREW_MODEL_GENIUS', 'google/gemini-3.1-pro-preview-customtools'),
    );

/** Smart-tier model for complex reasoning (Reviewer, Architect, Security). */
export const smartModel = isCursor('CREW_MODEL_SMART')
  ? cursorCLI('composer-1.5', { mode: 'agent', timeoutMs: 120_000 })
  : makeProvider('CREW_MODEL_SMART_BASE_URL', 'CREW_MODEL_SMART_API_KEY').chat(
      getModelId('CREW_MODEL_SMART', 'google/gemini-3.1-pro-preview-customtools'),
    );

/** Fast-tier model for general tasks (PM, User Advocate). */
export const fastModel = isCursor('CREW_MODEL_FAST')
  ? cursorCLI('composer-1.5', { mode: 'agent', timeoutMs: 120_000 })
  : makeProvider('CREW_MODEL_FAST_BASE_URL', 'CREW_MODEL_FAST_API_KEY').chat(
      getModelId('CREW_MODEL_FAST', 'google/gemini-3.1-pro-preview-customtools'),
    );

/**
 * Mini-tier model — smallest and cheapest.
 * Use for simple, high-volume tasks: title summarization, tag extraction, classification.
 */
export const miniModel = isCursor('CREW_MODEL_MINI')
  ? cursorCLI('composer-1.5', { mode: 'agent', timeoutMs: 120_000 })
  : makeProvider('CREW_MODEL_MINI_BASE_URL', 'CREW_MODEL_MINI_API_KEY').chat(
      getModelId('CREW_MODEL_MINI', 'google/gemini-3.1-flash-preview-customtools'),
    );

/**
 * Coder-tier LLM — used by NativeCodebaseBackend when CREW_MODEL_CODER is not set to Cursor.
 */
export const coderModel = makeProvider(
  'CREW_MODEL_CODER_BASE_URL',
  'CREW_MODEL_CODER_API_KEY',
).chat(getModelId('CREW_MODEL_CODER', 'google/gemini-3.1-pro-preview-customtools'));

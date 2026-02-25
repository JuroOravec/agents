/**
 * Central model registry for AI crews.
 *
 * Model tiers — override via env:
 *   CREW_MODEL_SMART        = "provider:model"  (e.g. openai:gpt-5)
 *   CREW_MODEL_FAST         = "provider:model"  (e.g. openai:gpt-5-mini)
 *   cursor:composer-1-5     = use Cursor CLI (ChatCursorCLI) for all agents
 *
 * Custom base URL — for OpenAI-compatible proxies (OpenRouter, Modal, vLLM):
 *   CREW_MODEL_SMART_BASE_URL   → e.g. https://openrouter.ai/api/v1
 *   CREW_MODEL_FAST_BASE_URL    → e.g. https://openrouter.ai/api/v1
 *
 * Token cap — for OpenRouter/limited credits, cap output to stay within budget:
 *   CREW_MAX_TOKENS  → e.g. 2048 (defaults to provider default, often 65536)
 *
 * Timeout — for slow/cold-start endpoints (e.g. Modal GLM-5):
 *   CREW_TIMEOUT_MS  → e.g. 180000 (3 min); defaults to LangChain default (~10 min)
 *
 * API keys — optional overrides (fallback: provider-standard vars in env):
 *   CREW_MODEL_SMART_API_KEY  → overrides OPENAI_API_KEY / ANTHROPIC_API_KEY etc. for smart tier
 *   CREW_MODEL_FAST_API_KEY   → overrides for fast tier
 *   For OpenRouter, use your OpenRouter API key.
 *
 * See docs/features/ai-crews/crew_ai.md § "Managing which models for which agents".
 */

import "dotenv/config"; // Load .env file

import { ChatCursorCLI } from "./utils/cursor.js";

export type LlmConfig = {
  provider: string;
  model: string;
  apiKey?: string;
  apiBaseUrl?: string;
  maxTokens?: number;
  timeout?: number;
};

function parseModelEnv(input: {
  key: string;
  apiKeyKey: string;
  baseUrlKey: string;
  defaultProvider: string;
  defaultModel: string;
}): LlmConfig {
  const { key, apiKeyKey, baseUrlKey, defaultProvider, defaultModel } = input;
  const val = process.env[key];
  let provider = defaultProvider;
  let model = defaultModel;
  if (val) {
    const sep = val.includes(":") ? ":" : "/";
    const parts = val.split(sep);
    provider = (parts[0] ?? defaultProvider).trim();
    model = (parts[1] ?? defaultModel).trim();
  }
  const apiKey = process.env[apiKeyKey]?.trim();
  const apiBaseUrl = process.env[baseUrlKey]?.trim();
  const maxTokensEnv = process.env.CREW_MAX_TOKENS?.trim();
  const maxTokens = maxTokensEnv ? parseInt(maxTokensEnv, 10) : undefined;
  const timeoutMsEnv = process.env.CREW_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutMsEnv ? parseInt(timeoutMsEnv, 10) : undefined;
  const config: LlmConfig = { provider, model };
  if (apiKey) config.apiKey = apiKey;
  if (apiBaseUrl) {
    config.apiBaseUrl = apiBaseUrl;
    config.provider = "openai"; // OpenAI-compatible endpoint (OpenRouter, Modal, vLLM)
    // OpenRouter expects "provider/model" (slash). Convert "provider:model" (colon) from env.
    const rawModel = val?.trim() ?? model;
    config.model = rawModel.includes(":") ? rawModel.replace(":", "/") : rawModel;
  }
  if (maxTokens && !Number.isNaN(maxTokens)) config.maxTokens = maxTokens;
  if (timeoutMs && !Number.isNaN(timeoutMs)) config.timeout = timeoutMs;
  return config;
}

/** Raw config for smart tier (e.g. for display). Prefer spreading smartLlm into Agent. */
export const smartLlmConfig: LlmConfig = parseModelEnv({
  key: "CREW_MODEL_SMART",
  apiKeyKey: "CREW_MODEL_SMART_API_KEY",
  baseUrlKey: "CREW_MODEL_SMART_BASE_URL",
  defaultProvider: "openai",
  defaultModel: "gpt-5",
});

/** Raw config for fast tier (e.g. for display). Prefer spreading fastLlm into Agent. */
export const fastLlmConfig: LlmConfig = parseModelEnv({
  key: "CREW_MODEL_FAST",
  apiKeyKey: "CREW_MODEL_FAST_API_KEY",
  baseUrlKey: "CREW_MODEL_FAST_BASE_URL",
  defaultProvider: "openai",
  defaultModel: "gpt-5-mini",
});

/** Cursor CLI LLM — used when model is cursor:composer-1-5. */
export const cursorLlm = new ChatCursorCLI({
  model: "composer-1.5",
  mode: "ask",
  timeoutMs: 120_000,
});

/** Cursor CLI mode: use raw env so BASE_URL override doesn't bypass it. */
const isCursorLlmMode = (() => {
  const raw = process.env.CREW_MODEL_SMART?.trim();
  return raw === "cursor:composer-1-5" || raw === "cursor/composer-1-5";
})();

/** Spreadable Agent LLM — smart tier. Use {...smartLlm} in Agent. */
export const smartLlm = isCursorLlmMode
  ? { llmInstance: cursorLlm }
  : { llmConfig: smartLlmConfig };

/** Spreadable Agent LLM — fast tier. Use {...fastLlm} in Agent. */
export const fastLlm = isCursorLlmMode
  ? { llmInstance: cursorLlm }
  : { llmConfig: fastLlmConfig };

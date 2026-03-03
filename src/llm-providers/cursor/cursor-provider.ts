#!/usr/bin/env node
/**
 * Vercel AI SDK LanguageModelV3 that delegates to the Cursor Agent CLI.
 *
 * Use with Mastra agents via: model: cursorCLI("composer-1.5")
 *
 * Prerequisites: cursor-agent installed and logged in.
 *   curl https://cursor.com/install -fsS | bash
 *   cursor-agent login
 *
 * Mode: "ask" = read-only Q&A (no file edits). "plan" = planning only.
 * For PRD review and similar tasks, use mode "ask".
 */

import { spawn } from 'node:child_process';

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3TextPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

// ─── stream-json event types ───────────────────────────────────────────────
// cursor-agent emits NDJSON lines when --output-format stream-json is used.
// Each line is one of the following event shapes.

/** A text delta from the assistant's response. */
export interface CursorTextEvent {
  type: 'assistant';
  message: { role: 'assistant'; content: Array<{ type: 'text'; text: string }> };
  session_id: string;
}

/** A tool call started or completed (subtype distinguishes them). */
export interface CursorToolCallEvent {
  type: 'tool_call';
  subtype: 'started' | 'completed';
  /** Keyed by tool type, e.g. shellToolCall, editToolCall, readToolCall, writeToolCall, … */
  tool_call: Record<string, { args?: Record<string, unknown>; result?: unknown }>;
  session_id: string;
}

/** Final result line emitted when the agent run finishes. */
export interface CursorResultEvent {
  type: 'result';
  subtype: string;
  result?: string;
  duration_ms?: number;
  session_id: string;
}

export type CursorStreamEvent =
  | CursorTextEvent
  | CursorToolCallEvent
  | CursorResultEvent
  | { type: string; [k: string]: unknown };

// ─── Provider options ──────────────────────────────────────────────────────

export interface CursorCLIModelOptions {
  /** "composer-1.5" or any model supported by cursor-agent --model */
  model?: string;
  /** "ask" = read-only Q&A (no edits). Default: "ask" */
  mode?: 'ask' | 'plan' | 'agent';
  /** Timeout in ms. Default: 120000 */
  timeoutMs?: number;
  /** Pass --trust to skip workspace trust prompt (required for headless). Default: true */
  trustWorkspace?: boolean;
  /** Working directory for cursor-agent. Default: process.cwd() */
  workspace?: string;
  /**
   * Called with each text delta from the assistant as it streams.
   * Receives only the text content, not raw JSON lines.
   */
  onChunk?: (chunk: string) => void;
  /**
   * Called with each parsed stream-json event as it arrives.
   * Use to observe tool_call started/completed events, result events, etc.
   */
  onEvent?: (event: CursorStreamEvent) => void;
}

function extractTextFromContent(
  content: string | Array<LanguageModelV3TextPart | { type: string; text?: string }>,
): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is LanguageModelV3TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

function promptToString(prompt: LanguageModelV3Prompt): string {
  const parts: string[] = [];
  for (const message of prompt) {
    if (message.role === 'system') {
      parts.push(`[System]: ${extractTextFromContent(message.content)}`);
    } else if (message.role === 'user') {
      parts.push(`[User]: ${extractTextFromContent(message.content)}`);
    } else if (message.role === 'assistant') {
      parts.push(`[Assistant]: ${extractTextFromContent(message.content)}`);
    }
  }
  return parts.join('\n\n');
}

interface RunOpts {
  model: string | undefined;
  mode: 'ask' | 'plan' | 'agent';
  timeoutMs: number;
  trustWorkspace: boolean;
  workspace: string;
  onChunk?: (chunk: string) => void;
  onEvent?: (event: CursorStreamEvent) => void;
}

/**
 * Parses a single NDJSON line from cursor-agent's stream-json output.
 * Returns null for blank or unparseable lines.
 */
export function parseCursorEventLine(line: string): CursorStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as CursorStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Extracts the human-readable summary text from a cursor-agent result event.
 * Falls back to an empty string if not present.
 */
function extractResultText(event: CursorResultEvent): string {
  return event.result ?? '';
}

/**
 * Spawns cursor-agent with --output-format stream-json --stream-partial-output.
 * Parses each NDJSON line as it arrives and routes events to the supplied callbacks:
 *   - assistant text deltas → onChunk(text)
 *   - all events           → onEvent(event)
 * Resolves with the final result text when the process closes.
 */
function runCursorCLI(prompt: string, opts: RunOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--stream-partial-output'];
    if (opts.mode !== 'agent') {
      args.push('--mode', opts.mode);
    }
    if (opts.trustWorkspace) args.push('--trust');
    if (opts.model) args.push('--model', opts.model);
    if (opts.workspace) args.push('--workspace', opts.workspace);

    const proc = spawn('cursor-agent', args, {
      stdio: 'pipe',
      cwd: opts.workspace,
    });

    let lineBuffer = '';
    let resultText = '';
    let stderr = '';

    proc.stdout?.on('data', (c: Buffer) => {
      lineBuffer += c.toString();
      // Split on newlines, keeping incomplete trailing line in buffer.
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const event = parseCursorEventLine(line);
        if (!event) continue;

        opts.onEvent?.(event);

        if (event.type === 'assistant') {
          const e = event as CursorTextEvent;
          for (const part of e.message.content) {
            if (part.type === 'text' && part.text) {
              opts.onChunk?.(part.text);
            }
          }
        } else if (event.type === 'result') {
          resultText = extractResultText(event as CursorResultEvent);
        }
      }
    });

    proc.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Cursor CLI timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      // Flush any remaining buffered line.
      if (lineBuffer.trim()) {
        const event = parseCursorEventLine(lineBuffer);
        if (event) {
          opts.onEvent?.(event);
          if (event.type === 'result') {
            resultText = extractResultText(event as CursorResultEvent);
          }
        }
      }
      if (code !== 0 && code !== null) {
        reject(new Error(`cursor-agent exited ${code}. stderr: ${stderr.slice(0, 500)}`));
      } else {
        resolve(resultText);
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.stdin?.end();
  });
}

export class CursorCLILanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'cursor-cli';
  readonly supportedUrls: Record<string, RegExp[]> = {};

  readonly modelId: string;
  private readonly opts: RunOpts;

  constructor(modelId: string, options: CursorCLIModelOptions = {}) {
    this.modelId = modelId;
    this.opts = {
      model: options.model ?? modelId,
      mode: options.mode ?? 'ask',
      timeoutMs: options.timeoutMs ?? 120_000,
      trustWorkspace: options.trustWorkspace ?? true,
      workspace: options.workspace ?? process.cwd(),
      onChunk: options.onChunk,
      onEvent: options.onEvent,
    };
  }

  async doGenerate(options: LanguageModelV3CallOptions) {
    const prompt = promptToString(options.prompt);
    const text = await runCursorCLI(prompt, this.opts);

    const finishReason = {
      unified: 'stop',
      raw: undefined,
    } satisfies LanguageModelV3FinishReason;
    const usage = {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    } satisfies LanguageModelV3Usage;

    return {
      content: [{ type: 'text' as const, text }],
      finishReason,
      usage,
      warnings: [],
    };
  }

  async doStream(options: LanguageModelV3CallOptions) {
    const { content, finishReason, usage } = await this.doGenerate(options);

    const textId = 'cursor-cli-text-1';

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        for (const part of content) {
          if (part.type === 'text') {
            controller.enqueue({ type: 'text-start', id: textId });
            if (part.text) {
              controller.enqueue({ type: 'text-delta', id: textId, delta: part.text });
            }
            controller.enqueue({ type: 'text-end', id: textId });
          }
        }
        controller.enqueue({ type: 'finish', finishReason, usage });
        controller.close();
      },
    });

    return { stream };
  }
}

export function createCursorProvider(defaults: CursorCLIModelOptions = {}) {
  return function cursorCLI(
    modelId: string,
    overrides: CursorCLIModelOptions = {},
  ): CursorCLILanguageModel {
    return new CursorCLILanguageModel(modelId, { ...defaults, ...overrides });
  };
}

export const cursorCLI = createCursorProvider();

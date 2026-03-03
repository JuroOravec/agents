/**
 * Cursor CLI adapter for the CodebaseBackend interface.
 *
 * This is the only file that knows about cursor-provider internals.
 * Everything outside this file interacts through the CodebaseBackend interface.
 *
 * Not an LLM or agent — it delegates to the cursor-agent CLI subprocess.
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */

import {
  cursorCLI,
  type CursorStreamEvent,
  type CursorToolCallEvent,
} from '../../llm-providers/cursor/cursor-provider.js';
import type { CodebaseBackend, CodebaseBackendCallbacks } from './codebase-backend.js';

/** @deprecated Use CodebaseBackendCallbacks from codebase-backend.ts directly. */
export type CursorCodebaseBackendCallbacks = CodebaseBackendCallbacks;

// ─── Cursor stream-json display (for CLI) ────────────────────────────────────

/** Display labels for cursor-agent internal tool names (stream-json tool_call keys). */
export const CURSOR_TOOL_LABELS: Record<string, string> = {
  shellToolCall: 'shell',
  editToolCall: 'edit',
  readToolCall: 'read',
  writeToolCall: 'write',
  deleteToolCall: 'delete',
  grepToolCall: 'grep',
  lsToolCall: 'ls',
  globToolCall: 'glob',
  todoToolCall: 'todo',
  updateTodosToolCall: 'todo update',
};

/** Prefix for cursor-agent tool event lines in the CLI. */
export const CURSOR_EVENT_PREFIX = '↳ [cursor] ';

/**
 * Formats a Cursor stream-json event for CLI display.
 * Returns null if the event should not be shown (e.g. successful completion).
 *
 * @param event - A parsed CursorStreamEvent from cursor-agent.
 * @returns `{ line, isFailure }` or null if nothing to display.
 */
export function formatCursorEvent(
  event: CursorStreamEvent,
): { line: string; isFailure: boolean } | null {
  if (event.type !== 'tool_call') return null;
  const e = event as CursorToolCallEvent;
  const toolKey = Object.keys(e.tool_call)[0] ?? 'unknown';
  const label = CURSOR_TOOL_LABELS[toolKey] ?? toolKey;
  const tool = e.tool_call[toolKey];

  if (e.subtype === 'started') {
    const args = tool?.args ?? {};
    const detail =
      (args['path'] as string | undefined) ??
      (args['command'] as string | undefined) ??
      (args['pattern'] as string | undefined) ??
      '';
    const detailStr = detail ? ` ${String(detail).slice(0, 60)}` : '';
    return { line: `    ${CURSOR_EVENT_PREFIX}${label}${detailStr}`, isFailure: false };
  }

  if (e.subtype === 'completed') {
    const result = tool?.result as Record<string, unknown> | undefined;
    if (result && !result['success']) {
      return { line: `    ✗ [cursor] ${label} failed`, isFailure: true };
    }
  }
  return null;
}

/**
 * Builds an `onCursorEvent` handler for use in the CLI.
 * Cursor-specific formatting (labels, prefix) lives here; the caller supplies
 * flush and log to wire into their UI layer.
 *
 * @param flush - Called before logging to close any open thought line.
 * @param log - Called with the formatted line and whether it is a failure.
 */
export function makeCursorEventHandler(
  flush: () => void,
  log: (line: string, isFailure: boolean) => void,
): (event: CursorStreamEvent) => void {
  return (event: CursorStreamEvent) => {
    const formatted = formatCursorEvent(event);
    if (formatted) {
      flush();
      log(formatted.line, formatted.isFailure);
    }
  };
}

/** Options for CursorCodebaseBackend. */
export interface CursorCodebaseBackendOpts {
  worktreePath: string;
  callbacks?: CodebaseBackendCallbacks;
  cursorModelName?: string;
}

/**
 * CodebaseBackend backed by the Cursor CLI (`cursor-agent`).
 *
 * Not an agent — delegates to a subprocess. No Mastra agent involved.
 *
 * - `ask`  → `cursor-agent --mode ask`   (read-only, never writes files)
 * - `edit` → `cursor-agent --mode agent` (full edit, runs check:agent before returning)
 *
 * Both calls are scoped to `worktreePath` for isolation.
 */
export class CursorCodebaseBackend implements CodebaseBackend {
  private readonly worktreePath: string;
  private readonly callbacks: CodebaseBackendCallbacks;
  private readonly cursorModelName: string;

  constructor(opts: CursorCodebaseBackendOpts) {
    this.worktreePath = opts.worktreePath;
    this.callbacks = opts.callbacks ?? {};
    this.cursorModelName = opts.cursorModelName ?? 'composer-1.5';
  }

  /** @inheritdoc */
  async ask(query: string, context?: string): Promise<string> {
    const promptText = buildAskPrompt(query, context);
    const model = cursorCLI(this.cursorModelName, {
      workspace: this.worktreePath,
      mode: 'ask',
      onChunk: this.callbacks.onChunk,
      onEvent: this.callbacks.onCursorEvent,
    });
    return runCursorModel(model, promptText);
  }

  /** @inheritdoc */
  async edit(directive: string, context?: string): Promise<string> {
    const promptText = buildEditPrompt(directive, context);
    const model = cursorCLI(this.cursorModelName, {
      workspace: this.worktreePath,
      mode: 'agent',
      onChunk: this.callbacks.onChunk,
      onEvent: this.callbacks.onCursorEvent,
    });
    return runCursorModel(model, promptText);
  }
}

// ─── Prompt builders ───────────────────────────────────────────────────────

function buildAskPrompt(query: string, context?: string): string {
  return [
    context ? `Context: ${context}` : null,
    `Query: ${query}`,
    '',
    'Do not summarize or explain the code. Use your semantic search tools to find the most relevant code snippets.',
    'Return the EXACT file paths, line numbers, and raw code content for everything you find.',
    'Do NOT create, modify, or delete any files.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildEditPrompt(directive: string, context?: string): string {
  return [
    context ? `Context: ${context}` : null,
    `Task: ${directive}`,
    '',
    'CRITICAL: You must execute this inside the provided workspace.',
    'When you are done making changes, you MUST run `npm run check:agent` inside this workspace.',
    'Do not stop iterating until the status is PASSED.',
    'Return a summary of the files you changed and why.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ─── Shared execution helper ───────────────────────────────────────────────

/** Calls doGenerate on a cursor-provider model, extracts text, and catches errors. */
async function runCursorModel(
  model: ReturnType<typeof cursorCLI>,
  promptText: string,
): Promise<string> {
  try {
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: promptText }] }],
    });
    return extractText(result.content);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Extracts plain text from a Vercel AI SDK content array or string. */
function extractText<T extends { type: 'text'; text: string }>(content: T[]): string {
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
  }
  return String(content ?? '');
}

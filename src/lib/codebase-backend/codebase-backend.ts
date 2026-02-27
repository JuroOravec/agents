/**
 * CodebaseBackend — pluggable interface for the code-reading/writing capability
 * used by the Reviewer (read-only) and Worker (read + write) agents.
 *
 * This is not an LLM and not necessarily an agent. It is a backend abstraction
 * that executes codebase operations (read Q&A, edit + validate). Implementations
 * may use a CLI (e.g. cursor-agent), a Mastra agent with tools, or other means.
 *
 * The interface decouples the Thinker LLM from whatever actually touches files.
 * The active implementation is selected at construction time via
 * `createCodebaseBackend()`.
 *
 * - `ask`  — read-only Q&A about the codebase, never writes files
 * - `edit` — applies code changes and runs `npm run check:agent` to validate
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */

import 'dotenv/config';

import type { DrainableChunk } from '../../crews/utils/drain-stream.js';
import type { CursorStreamEvent } from '../../llm-providers/cursor/cursor-provider.js';
import { coderModel } from '../../models.js';
import { CursorCodebaseBackend } from './cursor-codebase-backend.js';
import { NativeCodebaseBackend } from './native-codebase-backend.js';

// ─── Public interface ──────────────────────────────────────────────────────

/**
 * Pluggable interface for the component that reads and/or writes code.
 *
 * Implementations may be CLI adapters, Mastra agents, or other backends.
 * They are stateless per-call — each invocation of `ask` or `edit` is independent.
 * State (worktree path, callbacks) is provided at construction time and remains
 * constant for the lifetime of one agent round.
 */
export interface CodebaseBackend {
  /**
   * Read-only query about the codebase.
   * Must never create, modify, or delete files.
   *
   * @param query   - The question or information request.
   * @param context - Optional extra context to help scope the answer.
   * @returns A text answer.
   */
  ask(query: string, context?: string): Promise<string>;

  /**
   * Apply code changes to the worktree.
   * Must run `npm run check:agent` before returning and iterate until PASSED.
   *
   * @param directive - What to implement (composed by the Thinker per call).
   * @param context   - Optional extra context or constraints.
   * @returns A summary of what was changed and why.
   */
  edit(directive: string, context?: string): Promise<string>;
}

// ─── Callbacks ─────────────────────────────────────────────────────────────

/**
 * Streaming callbacks forwarded from the outer CLI through the tool layer.
 *
 * Each implementation uses a subset of these:
 * - CursorCodebaseBackend  uses `onChunk` + `onEvent` (CursorStreamEvent)
 * - NativeCodebaseBackend  uses `onThought` + `onEvent` (DrainableChunk)
 */
export interface CodebaseBackendCallbacks {
  /** Text delta as it streams from the backend (Cursor: assistant text; Native: LLM text). */
  onChunk?: (chunk: string) => void;
  /** Called with each text/reasoning delta from the inner LLM (Native only). */
  onThought?: (delta: string) => void;
  /** Cursor stream-json event (tool_call, result, …). Used by CursorCodebaseBackend. */
  onCursorEvent?: (event: CursorStreamEvent) => void;
  /** Mastra fullStream chunk (tool-call, tool-result, …). Used by NativeCodebaseBackend. */
  onEvent?: (chunk: DrainableChunk) => void;
}

// ─── Factory ───────────────────────────────────────────────────────────────

function isCursorCoder(): boolean {
  const raw = process.env.CREW_MODEL_CODER?.trim();
  return raw === 'cursor:composer-1-5' || raw === 'cursor/composer-1-5';
}

/**
 * Creates the configured CodebaseBackend for the given worktree.
 *
 * Not an LLM or agent — returns a backend that executes codebase read/edit operations.
 * Implementation is selected via `CREW_MODEL_CODER`:
 * - `cursor:composer-1-5` → `CursorCodebaseBackend`  (delegates to cursor-agent CLI)
 * - anything else         → `NativeCodebaseBackend`  (Mastra Agent + fs/shell tools)
 *
 * @param worktreePath - The isolated git worktree the backend operates in.
 * @param callbacks    - Optional streaming callbacks.
 */
export function createCodebaseBackend(
  worktreePath: string,
  callbacks: CodebaseBackendCallbacks = {},
): CodebaseBackend {
  if (isCursorCoder()) {
    return new CursorCodebaseBackend({ worktreePath, callbacks });
  }

  return new NativeCodebaseBackend({ worktreePath, llm: coderModel, callbacks });
}

/**
 * Native (non-Cursor) CodebaseBackend implementation.
 *
 * Uses a Mastra Agent equipped with raw filesystem and shell tools to read and
 * write code — no Cursor CLI required. One implementation uses an LLM-backed
 * agent; the backend interface itself is not an LLM or model.
 *
 * Architecture (Agent-in-Agent):
 *   Worker Thinker  →  editCodebase tool
 *                        →  NativeCodebaseBackend.edit()
 *                             →  NativeWriter Agent  (readFile, writeFile, runShell)
 *                                  → iterates until check:agent passes
 *                                  → returns summary string
 *
 * Streaming callbacks:
 *   - `onThought`  — text/reasoning deltas from the inner NativeWriter LLM
 *   - `onEvent`    — every Mastra fullStream chunk (tool-call, tool-result, …)
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */

import { Agent } from '@mastra/core/agent';

import { type DrainableChunk, drainFullStream } from '../../crews/utils/drain-stream.js';
import type { CodebaseBackend, CodebaseBackendCallbacks } from './codebase-backend.js';
import {
  createListDirTool,
  createReadFileTool,
  createRunShellTool,
  createSearchCodeTool,
  createWriteFileTool,
} from './native-tools.js';

type Model = ConstructorParameters<typeof Agent>[0]['model'];

/** Options for NativeCodebaseBackend. */
export interface NativeCodebaseBackendOpts {
  worktreePath: string;
  llm: Model;
  callbacks?: CodebaseBackendCallbacks;
}

/**
 * CodebaseBackend backed by a Mastra Agent with native filesystem and shell tools.
 *
 * Uses an agent internally, but the CodebaseBackend interface is implementation-agnostic.
 *
 * - `ask`  — runs a read-only NativeReader agent (readFile, listDir, searchCode)
 * - `edit` — runs a NativeWriter agent (readFile, writeFile, runShell) that
 *            iterates until `npm run check:agent` passes
 *
 * Both agents are scoped to `worktreePath`.
 * Uses `onThought` and `onEvent` from the shared CodebaseBackendCallbacks.
 */
export class NativeCodebaseBackend implements CodebaseBackend {
  private readonly worktreePath: string;
  private readonly llm: Model;
  private readonly callbacks: CodebaseBackendCallbacks;

  constructor(opts: NativeCodebaseBackendOpts) {
    this.worktreePath = opts.worktreePath;
    this.llm = opts.llm;
    this.callbacks = opts.callbacks ?? {};
  }

  /** @inheritdoc */
  async ask(query: string, context?: string): Promise<string> {
    const agent = new Agent({
      name: 'NativeReader',
      instructions:
        'You are a code reading assistant. Use the provided tools to find the answer. ' +
        'Do NOT create, modify, or delete any files.',
      model: this.llm,
      tools: {
        readFile: createReadFileTool(this.worktreePath),
        listDir: createListDirTool(this.worktreePath),
        searchCode: createSearchCodeTool(this.worktreePath),
      },
    });

    const prompt = context ? `Context: ${context}\n\nQuestion: ${query}` : query;
    return this.runAgent(agent, prompt);
  }

  /** @inheritdoc */
  async edit(directive: string, context?: string): Promise<string> {
    const agent = new Agent({
      name: 'NativeWriter',
      instructions: [
        'You are a coding agent. Use your tools to implement the requested changes.',
        'CRITICAL: When you are done, you MUST run `npm run check:agent` using the runShell tool.',
        'If it fails, read the errors, fix the code, and run it again.',
        'Do NOT stop until check:agent passes.',
        'Return a summary of the files you changed and why.',
      ].join('\n'),
      model: this.llm,
      tools: {
        readFile: createReadFileTool(this.worktreePath),
        listDir: createListDirTool(this.worktreePath),
        searchCode: createSearchCodeTool(this.worktreePath),
        writeFile: createWriteFileTool(this.worktreePath),
        runShell: createRunShellTool(this.worktreePath),
      },
    });

    const prompt = context ? `Context: ${context}\n\nTask: ${directive}` : directive;
    return this.runAgent(agent, prompt);
  }

  // ─── Internal helper ──────────────────────────────────────────────────────

  /**
   * Streams a Mastra Agent and drains the fullStream, wiring optional callbacks.
   * Returns the final text output.
   */
  private async runAgent(agent: Agent, prompt: string): Promise<string> {
    const { onThought, onEvent } = this.callbacks as {
      onThought?: (d: string) => void;
      onEvent?: (c: DrainableChunk) => void;
    };

    const output = await agent.stream([{ role: 'user', content: prompt }]);

    // Drain fullStream concurrently with the text output — backpressure will
    // stall the agent if the stream is not consumed.
    const [text] = await Promise.all([
      output.text,
      drainFullStream(output.fullStream as ReadableStream<DrainableChunk>, {
        onThought,
        onEvent,
      }),
    ]);

    return text ?? '';
  }
}

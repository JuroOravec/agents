import { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';

import { type DrainableChunk, drainFullStream } from '../../crews/utils/drain-stream.js';
import {
  type ReviewerIssueList,
  type WorkerMemory,
  type WorkerReport,
  WorkerReportSchema,
} from '../../crews/utils/iteration-loop.js';
import type { CodebaseBackend } from '../../lib/codebase-backend/index.js';
import { smartModel } from '../../models.js';
import {
  CODEBASE_BACKEND_CONTEXT_KEY,
  editCodebaseTool,
  readCodebaseTool,
} from '../tools/codebase.js';

/**
 * Worker agent — static definition.
 * Tools read codebaseBackend from requestContext at execution time.
 */
export const workerAgent = new Agent({
  name: 'Worker',
  instructions:
    'You are an autonomous worker agent. You receive issues from a Reviewer and fix them.\n' +
    'You have two tools:\n' +
    '  • readCodebase  — ask a read-only question about the codebase (use this first to understand context)\n' +
    '  • editCodebase  — apply code changes to the worktree (validation runs automatically)\n' +
    'Always read before you edit. Compose a precise, targeted directive for each editCodebase call.',
  model: smartModel,
  tools: {
    readCodebase: readCodebaseTool,
    editCodebase: editCodebaseTool,
  },
});

function createWorkerPrompt(opts: {
  issueList: ReviewerIssueList;
  workerMemory: WorkerMemory;
  worktreePath: string;
}) {
  const { issueList, workerMemory, worktreePath } = opts;
  return (
    'Issues to Fix:\n' +
    JSON.stringify(issueList, null, 2) +
    '\n\n' +
    'Worker Memory (Previous Reports & Resolutions):\n' +
    JSON.stringify(workerMemory, null, 2) +
    '\n\n' +
    'Worktree Path: ' +
    worktreePath +
    '\n\n' +
    'Fix the issues. Use readCodebase to understand the current state, then editCodebase to apply changes.\n' +
    'After changes are applied, return a summary report of what you did.'
  );
}

/** Options for runWorkerRound. */
export interface RunWorkerRoundOpts {
  issueList: ReviewerIssueList;
  worktreePath: string;
  workerMemory: WorkerMemory;
  /** The codebase backend. Must implement CodebaseBackend (read + write). */
  codebaseBackend: CodebaseBackend;
  /** Called with each text/reasoning delta from the Thinker LLM. */
  onThought?: (delta: string) => void;
  /** Called with every Mastra fullStream chunk — use to observe tool-call/tool-result events. */
  onEvent?: (chunk: DrainableChunk) => void;
  /** Optional abort signal — when aborted, the in-flight LLM call is cancelled. */
  abortSignal?: AbortSignal;
}

/**
 * Executes a single round for the Worker agent.
 *
 * The Worker receives a list of issues from the Reviewer and has two tools:
 * - `readCodebase`  — ask a question about the codebase (read-only, ask mode)
 * - `editCodebase`  — apply code changes and validate via `npm run check:agent`
 *
 * Both tools read `codebaseBackend` from the requestContext passed at execution time.
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */
export async function runWorkerRound(opts: RunWorkerRoundOpts): Promise<WorkerReport> {
  const {
    issueList,
    worktreePath,
    workerMemory,
    codebaseBackend,
    onThought,
    onEvent,
    abortSignal,
  } = opts;

  const requestContext = new RequestContext<{ [CODEBASE_BACKEND_CONTEXT_KEY]: CodebaseBackend }>();
  requestContext.set(CODEBASE_BACKEND_CONTEXT_KEY, codebaseBackend);

  const prompt = createWorkerPrompt({ issueList, workerMemory, worktreePath });
  const output = await workerAgent.stream([{ role: 'user', content: prompt }], {
    structuredOutput: { schema: WorkerReportSchema },
    requestContext,
    ...(abortSignal ? { abortSignal } : {}),
  });

  // CRITICAL: fullStream MUST be drained concurrently with output.object via Promise.all.
  // If the stream is not consumed, ReadableStream backpressure stalls the agent and
  // output.object never resolves. Using fullStream (not textStream) surfaces tool-call
  // and tool-result events in addition to text/reasoning deltas.
  const [result] = await Promise.all([
    output.object,
    drainFullStream(output.fullStream as ReadableStream<DrainableChunk>, {
      onThought,
      onEvent,
    }),
  ]);

  // Mastra resolves output.object as undefined when the stream is aborted rather
  // than throwing. Detect this and throw a proper AbortError so the iteration
  // loop's isAbortError() handler can catch it cleanly.
  if (result == null) {
    throw new DOMException('Worker stream was aborted.', 'AbortError');
  }

  return result as WorkerReport;
}

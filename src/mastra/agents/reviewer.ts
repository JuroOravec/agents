import { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';

import { type DrainableChunk, drainFullStream } from '../../crews/utils/drain-stream.js';
import {
  type ReviewerIssueList,
  ReviewerIssueListSchema,
  type ReviewerMemory,
  type WorkerMemory,
} from '../../crews/utils/iteration-loop.js';
import type { CheckAgentResult } from '../../crews/utils/run-check-agent.js';
import type { CodebaseBackend } from '../../lib/codebase-backend/index.js';
import { smartModel } from '../../models.js';
import { CODEBASE_BACKEND_CONTEXT_KEY, readCodebaseTool } from '../tools/codebase.js';

/**
 * Reviewer agent — static definition.
 * Has readCodebase only (read-only). Tools read codebaseBackend from requestContext at execution time.
 */
export const reviewerAgent = new Agent({
  name: 'Reviewer',
  instructions:
    'You are a senior tech lead. You review code against a goal. Provide a structured assessment. ' +
    'Examine the Worker Report and code changes carefully to see if the worker correctly implemented ' +
    'the requested fixes. You may use the readCodebase tool to look up context in the codebase — ' +
    'it is read-only and will never modify files. ' +
    'If the code meets the goal and previous issues are resolved, return status APPROVED. ' +
    'Otherwise, return NEEDS_WORK with a list of remaining issues.',
  model: smartModel,
  tools: {
    readCodebase: readCodebaseTool,
  },
});

function createReviewerPrompt(opts: {
  goal: string;
  worktreePath: string;
  workerMemory: WorkerMemory;
  reviewerMemory: ReviewerMemory;
  previousAnswers?: string[];
  checkResult?: CheckAgentResult;
  codeChanges?: string[];
}) {
  const {
    goal,
    worktreePath,
    workerMemory,
    reviewerMemory,
    previousAnswers,
    checkResult,
    codeChanges,
  } = opts;
  const answersSection =
    previousAnswers && previousAnswers.length > 0
      ? `\nHuman Answers to Previous Questions:\n${previousAnswers.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}\n`
      : '';

  const checkSection = checkResult
    ? checkResult.status === 'PASSED'
      ? `\nValidation (npm run check:agent): PASSED — types, lint, format, tests, coverage, and custom constraints all passed.\n`
      : `\nValidation (npm run check:agent): FAILED — the Worker's changes do not pass the deterministic validation engine (types, lint, format, tests, coverage, or custom constraints).\n` +
        `Phase: ${checkResult.phase}\nCommand: ${checkResult.command}\nDetails:\n${checkResult.details}\n` +
        `You MUST include an issue instructing the Worker to fix these validation failures. Do not approve until check:agent passes.\n`
    : '';

  return (
    'Goal: ' +
    goal +
    '\n' +
    'Worktree Path: ' +
    worktreePath +
    '\n\n' +
    'Reviewer Memory (Previous Rounds):\n' +
    JSON.stringify(reviewerMemory, null, 2) +
    '\n\n' +
    'Worker Memory (Previous Reports):\n' +
    JSON.stringify(workerMemory, null, 2) +
    '\n\n' +
    'Latest Code Changes:\n' +
    JSON.stringify(codeChanges, null, 2) +
    '\n' +
    checkSection +
    answersSection +
    '\n\n' +
    'Please review the latest code changes against the goal and provide your assessment.'
  );
}

/** Options for runReviewerRound. */
export interface RunReviewerRoundOpts {
  goal: string;
  worktreePath: string;
  workerMemory: WorkerMemory;
  reviewerMemory: ReviewerMemory;
  /** Human-provided answers to any clarification questions asked in the previous round. */
  previousAnswers?: string[];
  /** Called with each text/reasoning delta from the Reviewer LLM (for live display). */
  onThought?: (delta: string) => void;
  /** Called with every fullStream chunk — use to observe all LLM events. */
  onEvent?: (chunk: DrainableChunk) => void;
  /** Optional abort signal — when aborted, the in-flight LLM call is cancelled. */
  abortSignal?: AbortSignal;
  /** Read-only codebase backend (ask mode only) for codebase queries. */
  codebaseBackend: CodebaseBackend;
  /** Result of programmatic `npm run check:agent` run in the worktree. Injected by the orchestrator. */
  checkResult?: CheckAgentResult;
}

/**
 * Executes a single round for the Reviewer agent.
 *
 * The Reviewer analyzes the latest code changes in the worktree against the
 * original goal and previous memory. It has access to `readCodebase` (ask mode,
 * read-only) so it can look up context without touching files.
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */
export async function runReviewerRound(opts: RunReviewerRoundOpts): Promise<ReviewerIssueList> {
  const {
    goal,
    worktreePath,
    workerMemory,
    reviewerMemory,
    previousAnswers,
    onThought,
    onEvent,
    abortSignal,
    codebaseBackend,
    checkResult,
  } = opts;

  const requestContext = new RequestContext<{ [CODEBASE_BACKEND_CONTEXT_KEY]: CodebaseBackend }>();
  requestContext.set(CODEBASE_BACKEND_CONTEXT_KEY, codebaseBackend);

  const latestReport =
    workerMemory.allResolutions.length > 0
      ? workerMemory.allResolutions[workerMemory.allResolutions.length - 1].report
      : null;
  const codeChanges = latestReport?.codeChanges || [];

  const prompt = createReviewerPrompt({
    goal,
    worktreePath,
    workerMemory,
    reviewerMemory,
    previousAnswers,
    checkResult,
    codeChanges,
  });

  const output = await reviewerAgent.stream([{ role: 'user', content: prompt }], {
    structuredOutput: { schema: ReviewerIssueListSchema },
    requestContext,
    ...(abortSignal ? { abortSignal } : {}),
  });

  // CRITICAL: fullStream MUST be drained concurrently with output.object via Promise.all.
  // If the stream is not consumed, ReadableStream backpressure stalls the agent and
  // output.object never resolves.
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
    throw new DOMException('Reviewer stream was aborted.', 'AbortError');
  }

  return result as ReviewerIssueList;
}

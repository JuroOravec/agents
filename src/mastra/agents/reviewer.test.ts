/**
 * Unit tests for runReviewerRound (reviewer.ts).
 *
 * Verifies the `onThought` streaming contract: text deltas from the model's
 * textStream are forwarded to the caller in order, and the final structured
 * ReviewerIssueList is still resolved correctly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewerIssueList } from '../../crews/utils/iteration-loop.js';
import { runReviewerRound } from './reviewer.js';

// Shared stream mock — reviewerAgent is created at module load. vi.hoisted runs
// before mocks, so streamMock is defined when the mock factory runs.
const streamMock = vi.hoisted(() => vi.fn());
vi.mock('@mastra/core/agent', () => ({
  Agent: vi.fn().mockImplementation(() => ({ stream: streamMock })),
}));
vi.mock('../../models.js', () => ({
  smartModel: {},
}));

/**
 * Creates a fake MastraModelOutput-shaped object whose fullStream emits text-delta
 * chunks for the given deltas, and whose object property resolves to the given value.
 * This mirrors the shape that reviewer.ts now requires (fullStream, not textStream).
 */
function makeFakeOutput(deltas: string[], result: ReviewerIssueList) {
  const fullStream = new ReadableStream({
    start(controller) {
      for (const delta of deltas) {
        controller.enqueue({
          type: 'text-delta',
          payload: { text: delta, id: 'x' },
        });
      }
      controller.close();
    },
  });

  return {
    fullStream,
    object: Promise.resolve(result),
  };
}

describe('runReviewerRound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves with the structured ReviewerIssueList', async () => {
    const issueList: ReviewerIssueList = {
      status: 'APPROVED',
      issues: [],
      questions: [],
    };

    streamMock.mockResolvedValue(makeFakeOutput([], issueList));

    const codebaseBackend = {
      ask: vi.fn().mockResolvedValue(''),
      edit: vi.fn().mockResolvedValue(''),
    };
    const result = await runReviewerRound({
      goal: 'Fix the bug',
      worktreePath: '/tmp/worktree',
      workerMemory: { allReviewerIssues: [], allResolutions: [] },
      reviewerMemory: { feedbackLog: [] },
      codebaseBackend,
    });

    expect(result).toEqual(issueList);
  });

  it('calls onThought with each text delta in order', async () => {
    const deltas = ['Analyzing ', 'the ', 'code...'];
    const issueList: ReviewerIssueList = {
      status: 'NEEDS_WORK',
      issues: [],
      questions: [],
    };

    streamMock.mockResolvedValue(makeFakeOutput(deltas, issueList));

    const received: string[] = [];
    const codebaseBackend = {
      ask: vi.fn().mockResolvedValue(''),
      edit: vi.fn().mockResolvedValue(''),
    };
    await runReviewerRound({
      goal: 'Fix the bug',
      worktreePath: '/tmp/worktree',
      workerMemory: { allReviewerIssues: [], allResolutions: [] },
      reviewerMemory: { feedbackLog: [] },
      codebaseBackend,
      onThought: (delta) => received.push(delta),
    });

    expect(received).toEqual(deltas);
  });

  it('does not call onThought when not provided (no error)', async () => {
    const issueList: ReviewerIssueList = {
      status: 'APPROVED',
      issues: [],
      questions: [],
    };

    streamMock.mockResolvedValue(makeFakeOutput(['some delta'], issueList));

    const codebaseBackend = {
      ask: vi.fn().mockResolvedValue(''),
      edit: vi.fn().mockResolvedValue(''),
    };
    await expect(
      runReviewerRound({
        goal: 'Fix the bug',
        worktreePath: '/tmp/worktree',
        workerMemory: { allReviewerIssues: [], allResolutions: [] },
        reviewerMemory: { feedbackLog: [] },
        codebaseBackend,
      }),
    ).resolves.toEqual(issueList);
  });

  it('still resolves the object even after streaming all deltas', async () => {
    const deltas = ['chunk1', 'chunk2'];
    const issueList: ReviewerIssueList = {
      status: 'NEEDS_WORK',
      issues: [{ id: 'I-001', description: 'Missing test' }],
      questions: [],
    };

    streamMock.mockResolvedValue(makeFakeOutput(deltas, issueList));

    const thoughtCount = { n: 0 };
    const codebaseBackend = {
      ask: vi.fn().mockResolvedValue(''),
      edit: vi.fn().mockResolvedValue(''),
    };
    const result = await runReviewerRound({
      goal: 'Fix the bug',
      worktreePath: '/tmp/worktree',
      workerMemory: { allReviewerIssues: [], allResolutions: [] },
      reviewerMemory: { feedbackLog: [] },
      codebaseBackend,
      onThought: () => thoughtCount.n++,
    });

    expect(thoughtCount.n).toBe(2);
    expect(result.issues).toHaveLength(1);
  });
});

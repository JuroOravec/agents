/**
 * Unit tests for runWorkerRound.
 *
 * Verifies that the Worker agent:
 * - accepts a CodebaseBackend and exposes readCodebase + editCodebase tools
 * - passes the issue list and worktree path into the prompt
 * - returns a WorkerReport on success
 * - propagates abort errors when the stream is cancelled
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewerIssueList, WorkerMemory } from '../../crews/utils/iteration-loop.js';
import type { CodebaseBackend } from '../../lib/codebase-backend/index.js';
import { runWorkerRound, workerAgent } from './worker.js';

vi.mock('@mastra/core/agent', () => {
  const report = {
    summary: 'Fixed all issues',
    addressedIssues: [{ issueId: 'issue-1', resolution: 'Added export' }],
    stepsLog: ['Read the file', 'Added the export'],
    codeChanges: ['src/index.ts'],
  };
  return {
    Agent: vi.fn().mockImplementation(() => ({
      stream: vi.fn().mockResolvedValue({
        object: Promise.resolve(report),
        fullStream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: 'text-delta',
              payload: { text: 'thinking...' },
            });
            controller.close();
          },
        }),
      }),
    })),
  };
});

function makeCodebaseBackend(): CodebaseBackend {
  return {
    ask: vi.fn().mockResolvedValue('answer'),
    edit: vi.fn().mockResolvedValue('done'),
  };
}

const issueList: ReviewerIssueList = {
  status: 'NEEDS_WORK',
  issues: [{ id: 'issue-1', description: 'Fix the export' }],
  questions: [],
};

const workerMemory: WorkerMemory = {
  allReviewerIssues: [],
  allResolutions: [],
};

describe('runWorkerRound', () => {
  beforeEach(() => {
    workerAgent.stream.mockClear();
  });

  it('uses workerAgent with readCodebase and editCodebase tools', async () => {
    const codebaseBackend = makeCodebaseBackend();
    await runWorkerRound({ issueList, worktreePath: '/tmp/wt', workerMemory, codebaseBackend });

    expect(Agent).toHaveBeenCalled();
    const constructorArgs = vi.mocked(Agent).mock.calls[0][0];
    expect(constructorArgs.tools).toHaveProperty('readCodebase');
    expect(constructorArgs.tools).toHaveProperty('editCodebase');
  });

  it('passes requestContext with codebaseBackend to agent.stream', async () => {
    const codebaseBackend = makeCodebaseBackend();
    await runWorkerRound({ issueList, worktreePath: '/tmp/wt', workerMemory, codebaseBackend });

    const streamOptions = workerAgent.stream.mock.calls[0][1];
    expect(streamOptions.requestContext).toBeDefined();
    expect(streamOptions.requestContext.get('codebaseBackend')).toBe(codebaseBackend);
  });

  it('includes the issue list and worktree path in the prompt', async () => {
    const codebaseBackend = makeCodebaseBackend();
    await runWorkerRound({ issueList, worktreePath: '/tmp/wt', workerMemory, codebaseBackend });

    const promptArg = workerAgent.stream.mock.calls[0][0];
    const promptText = promptArg[0].content;
    expect(promptText).toContain('Fix the export');
    expect(promptText).toContain('/tmp/wt');
  });

  it('returns the WorkerReport from the agent', async () => {
    const codebaseBackend = makeCodebaseBackend();
    const result = await runWorkerRound({
      issueList,
      worktreePath: '/tmp/wt',
      workerMemory,
      codebaseBackend,
    });

    expect(result.summary).toBe('Fixed all issues');
    expect(result.codeChanges).toEqual(['src/index.ts']);
  });

  it('throws a DOMException AbortError when output.object resolves to undefined', async () => {
    workerAgent.stream.mockResolvedValueOnce({
      object: Promise.resolve(undefined),
      fullStream: new ReadableStream({
        start(c) {
          c.close();
        },
      }),
    });

    const codebaseBackend = makeCodebaseBackend();
    await expect(
      runWorkerRound({ issueList, worktreePath: '/tmp/wt', workerMemory, codebaseBackend }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

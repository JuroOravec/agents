/**
 * Authoritative TDD tests for the Iteration Loop (Reviewer + Worker).
 * These tests define the ground-truth contract that the implementation must satisfy.
 *
 * @see specs/agents/worker/README.md
 */

import { describe, expect, it, vi } from 'vitest';

import {
  type ReviewerIssueList,
  runIterationLoop,
  type WorkerReport,
} from '../../../src/crews/utils/iteration-loop.js';

describe('Iteration Loop (spec)', () => {
  it('exits with APPROVED when Reviewer approves, injecting memory correctly', async () => {
    const runReviewer = vi.fn();
    const runWorker = vi.fn();

    runReviewer.mockImplementationOnce(
      async (): Promise<ReviewerIssueList> => ({
        status: 'NEEDS_WORK',
        issues: [{ id: 'I-001', description: 'Fix the typo' }],
        questions: [],
      }),
    );

    runReviewer.mockImplementationOnce(
      async (): Promise<ReviewerIssueList> => ({
        status: 'APPROVED',
        issues: [],
        questions: [],
      }),
    );

    runWorker.mockImplementationOnce(
      async (): Promise<WorkerReport> => ({
        summary: 'Fixed typo',
        addressedIssues: [{ issueId: 'I-001', resolution: 'Corrected' }],
        stepsLog: ['Edited file'],
        codeChanges: ['readme.md'],
      }),
    );

    const result = await runIterationLoop({
      maxRounds: 5,
      worktreePath: '/tmp/spec-worktree',
      runReviewer,
      runWorker,
    });

    expect(result.finalStatus).toBe('APPROVED');
    expect(result.rounds).toBe(2);
    expect(runReviewer).toHaveBeenCalledTimes(2);
    expect(runWorker).toHaveBeenCalledTimes(1);
  });

  it('approves immediately on round 0 without ever calling Worker', async () => {
    const runReviewer = vi.fn().mockResolvedValue({
      status: 'APPROVED',
      issues: [],
      questions: [],
    } as ReviewerIssueList);

    const runWorker = vi.fn();

    const result = await runIterationLoop({
      maxRounds: 3,
      worktreePath: '/tmp/spec-worktree',
      runReviewer,
      runWorker,
    });

    expect(result.finalStatus).toBe('APPROVED');
    expect(result.rounds).toBe(1);
    expect(runReviewer).toHaveBeenCalledTimes(1);
    expect(runWorker).not.toHaveBeenCalled();
  });

  it('accumulates ReviewerMemory feedbackLog across rounds', async () => {
    const runReviewer = vi.fn();
    const runWorker = vi.fn().mockResolvedValue({
      summary: 'Fixed it',
      addressedIssues: [{ issueId: 'I-001', resolution: 'Done' }],
      stepsLog: [],
      codeChanges: [],
    } as WorkerReport);

    runReviewer.mockResolvedValueOnce({
      status: 'NEEDS_WORK',
      issues: [{ id: 'I-001', description: 'First issue' }],
      questions: [],
    } as ReviewerIssueList);

    runReviewer.mockResolvedValueOnce({
      status: 'APPROVED',
      issues: [],
      questions: [],
    } as ReviewerIssueList);

    const result = await runIterationLoop({
      maxRounds: 3,
      worktreePath: '/tmp/spec-worktree',
      runReviewer,
      runWorker,
    });

    // feedbackLog must have one entry per Reviewer round that returned NEEDS_WORK
    expect(result.reviewerMemory.feedbackLog).toHaveLength(2);
    expect(result.reviewerMemory.feedbackLog[0]!.round).toBe(0);
    expect(result.reviewerMemory.feedbackLog[0]!.issues).toEqual([
      { id: 'I-001', description: 'First issue' },
    ]);
    expect(result.reviewerMemory.feedbackLog[0]!.workerSummary).toBe('Fixed it');
  });

  it('accumulates WorkerMemory allResolutions across rounds', async () => {
    const runReviewer = vi.fn();
    const workerReport: WorkerReport = {
      summary: 'Fixed issue',
      addressedIssues: [{ issueId: 'I-001', resolution: 'Done' }],
      stepsLog: ['Edited file.ts'],
      codeChanges: ['file.ts'],
    };
    const runWorker = vi.fn().mockResolvedValue(workerReport);

    runReviewer.mockResolvedValueOnce({
      status: 'NEEDS_WORK',
      issues: [{ id: 'I-001', description: 'Broken' }],
      questions: [],
    } as ReviewerIssueList);

    runReviewer.mockResolvedValueOnce({
      status: 'APPROVED',
      issues: [],
      questions: [],
    } as ReviewerIssueList);

    const result = await runIterationLoop({
      maxRounds: 3,
      worktreePath: '/tmp/spec-worktree',
      runReviewer,
      runWorker,
    });

    expect(result.workerMemory.allResolutions).toHaveLength(1);
    expect(result.workerMemory.allResolutions[0]!.round).toBe(0);
    expect(result.workerMemory.allResolutions[0]!.report).toEqual(workerReport);

    expect(result.workerMemory.allReviewerIssues).toHaveLength(1);
    expect(result.workerMemory.allReviewerIssues[0]!.issues).toEqual([
      { id: 'I-001', description: 'Broken' },
    ]);
  });

  it('calls onQuestions when Reviewer has questions and passes answers to the next round', async () => {
    const runReviewer = vi.fn();
    const runWorker = vi.fn().mockResolvedValue({
      summary: 'Done',
      addressedIssues: [],
      stepsLog: [],
      codeChanges: [],
    } as WorkerReport);
    const onQuestions = vi.fn().mockResolvedValue(['Auth uses JWT']);

    // Round 0: has questions + issues
    runReviewer.mockResolvedValueOnce({
      status: 'NEEDS_WORK',
      issues: [{ id: 'I-001', description: 'Clarify auth approach' }],
      questions: ['Which auth strategy should we use?'],
    } as ReviewerIssueList);

    // Round 1: approved
    runReviewer.mockResolvedValueOnce({
      status: 'APPROVED',
      issues: [],
      questions: [],
    } as ReviewerIssueList);

    await runIterationLoop({
      maxRounds: 3,
      worktreePath: '/tmp/spec-worktree',
      runReviewer,
      runWorker,
      onQuestions,
    });

    // onQuestions must be called with the exact questions array
    expect(onQuestions).toHaveBeenCalledOnce();
    expect(onQuestions).toHaveBeenCalledWith(['Which auth strategy should we use?']);

    // The answers must be forwarded as previousAnswers to the next runReviewer call
    const secondCallOpts = runReviewer.mock.calls[1]![0];
    expect(secondCallOpts.previousAnswers).toEqual(['Auth uses JWT']);
  });

  it('does not call onQuestions when Reviewer has no questions', async () => {
    const runReviewer = vi.fn();
    const runWorker = vi.fn().mockResolvedValue({
      summary: 'Done',
      addressedIssues: [],
      stepsLog: [],
      codeChanges: [],
    } as WorkerReport);
    const onQuestions = vi.fn();

    runReviewer.mockResolvedValueOnce({
      status: 'NEEDS_WORK',
      issues: [{ id: 'I-001', description: 'Fix it' }],
      questions: [],
    } as ReviewerIssueList);

    runReviewer.mockResolvedValueOnce({
      status: 'APPROVED',
      issues: [],
      questions: [],
    } as ReviewerIssueList);

    await runIterationLoop({
      maxRounds: 3,
      worktreePath: '/tmp/spec-worktree',
      runReviewer,
      runWorker,
      onQuestions,
    });

    expect(onQuestions).not.toHaveBeenCalled();
  });

  it('does not call onQuestions when handler is not provided', async () => {
    const runReviewer = vi.fn().mockResolvedValue({
      status: 'APPROVED',
      issues: [],
      questions: ['Should we use tabs or spaces?'],
    } as ReviewerIssueList);

    const runWorker = vi.fn();

    // Should not throw even though questions are present and no handler is registered
    await expect(
      runIterationLoop({
        maxRounds: 3,
        worktreePath: '/tmp/spec-worktree',
        runReviewer,
        runWorker,
      }),
    ).resolves.not.toThrow();
  });

  it('exits with MAX_ROUNDS_REACHED when Reviewer never approves', async () => {
    const runReviewer = vi.fn().mockResolvedValue({
      status: 'NEEDS_WORK',
      issues: [{ id: 'I-001', description: 'Still broken' }],
      questions: [],
    } as ReviewerIssueList);

    const runWorker = vi.fn().mockResolvedValue({
      summary: 'Attempted fix',
      addressedIssues: [],
      stepsLog: [],
      codeChanges: [],
    } as WorkerReport);

    const result = await runIterationLoop({
      maxRounds: 2,
      worktreePath: '/tmp/spec-worktree',
      runReviewer,
      runWorker,
    });

    expect(result.finalStatus).toBe('MAX_ROUNDS_REACHED');
    expect(result.rounds).toBe(2);
    expect(runReviewer).toHaveBeenCalledTimes(2);
    expect(runWorker).toHaveBeenCalledTimes(2);
  });

  it('passes human answers to the Worker in the current round', async () => {
    const runReviewer = vi.fn().mockResolvedValueOnce({
      status: 'NEEDS_WORK',
      issues: [{ id: 'I-001', description: 'Implement auth' }],
      questions: ['Which auth strategy should we use?'],
    } as ReviewerIssueList);

    const runWorker = vi.fn().mockResolvedValue({
      summary: 'Done',
      addressedIssues: [],
      stepsLog: [],
      codeChanges: [],
    } as WorkerReport);

    const onQuestions = vi.fn().mockResolvedValue(['Auth uses JWT']);

    await runIterationLoop({
      maxRounds: 1,
      worktreePath: '/tmp/spec-worktree',
      runReviewer,
      runWorker,
      onQuestions,
    });

    // The Worker must receive the issueList with the human's answers attached
    // so the Thinker knows how to implement the requested changes.
    expect(runWorker).toHaveBeenCalledOnce();
    const passedIssueList = runWorker.mock.calls[0]![0].issueList;
    expect(passedIssueList.questions).toEqual(['Which auth strategy should we use?']);
    expect(passedIssueList.answers).toEqual(['Auth uses JWT']);
  });

  it('exits immediately with MAX_ROUNDS_REACHED if maxRounds is 0', async () => {
    const runReviewer = vi.fn();
    const runWorker = vi.fn();

    const result = await runIterationLoop({
      maxRounds: 0,
      worktreePath: '/tmp/spec-worktree',
      runReviewer,
      runWorker,
    });

    expect(result.finalStatus).toBe('MAX_ROUNDS_REACHED');
    expect(result.rounds).toBe(0);
    expect(runReviewer).not.toHaveBeenCalled();
    expect(runWorker).not.toHaveBeenCalled();
  });

  it('bubbles up errors thrown by the Reviewer or Worker', async () => {
    const runReviewer = vi.fn().mockRejectedValue(new Error('Reviewer failed'));
    const runWorker = vi.fn();

    await expect(
      runIterationLoop({
        maxRounds: 3,
        worktreePath: '/tmp/spec-worktree',
        runReviewer,
        runWorker,
      }),
    ).rejects.toThrow('Reviewer failed');

    const runReviewerOk = vi.fn().mockResolvedValue({
      status: 'NEEDS_WORK',
      issues: [{ id: '1', description: 'test' }],
      questions: [],
    } as ReviewerIssueList);
    const runWorkerFail = vi.fn().mockRejectedValue(new Error('Worker failed'));

    await expect(
      runIterationLoop({
        maxRounds: 3,
        worktreePath: '/tmp/spec-worktree',
        runReviewer: runReviewerOk,
        runWorker: runWorkerFail,
      }),
    ).rejects.toThrow('Worker failed');
  });

  it('runs correctly with maxRounds = Infinity, stopping after first APPROVED', async () => {
    const runReviewer = vi.fn();
    const runWorker = vi.fn().mockResolvedValue({
      summary: 'Fixed it',
      addressedIssues: [{ issueId: 'I-001', resolution: 'Done' }],
      stepsLog: [],
      codeChanges: [],
    } as WorkerReport);

    runReviewer.mockResolvedValueOnce({
      status: 'NEEDS_WORK',
      issues: [{ id: 'I-001', description: 'Broken' }],
      questions: [],
    } as ReviewerIssueList);

    runReviewer.mockResolvedValueOnce({
      status: 'APPROVED',
      issues: [],
      questions: [],
    } as ReviewerIssueList);

    const result = await runIterationLoop({
      maxRounds: Infinity,
      worktreePath: '/tmp/spec-worktree',
      runReviewer,
      runWorker,
    });

    // Must exit cleanly — not hang — as soon as APPROVED is returned
    expect(result.finalStatus).toBe('APPROVED');
    expect(result.rounds).toBe(2);
    expect(runReviewer).toHaveBeenCalledTimes(2);
    expect(runWorker).toHaveBeenCalledTimes(1);
  });
});

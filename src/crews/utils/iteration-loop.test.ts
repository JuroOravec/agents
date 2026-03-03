import { describe, expect, it, vi } from 'vitest';

import {
  isAbortError,
  type ReviewerIssueList,
  runIterationLoop,
  type WorkerReport,
} from './iteration-loop';

describe('runIterationLoop', () => {
  it('should run the loop until APPROVED, maintaining memory correctly', async () => {
    const runReviewer = vi.fn();
    const runWorker = vi.fn();

    // Mock Reviewer: Needs work on round 0, Approved on round 1
    runReviewer.mockImplementationOnce(async () => {
      return {
        status: 'NEEDS_WORK',
        issues: [{ id: 'issue-1', description: 'Fix typo' }],
        questions: [],
      } as ReviewerIssueList;
    });

    runReviewer.mockImplementationOnce(async () => {
      return {
        status: 'APPROVED',
        issues: [],
        questions: [],
      } as ReviewerIssueList;
    });

    // Mock Worker
    runWorker.mockImplementationOnce(async () => {
      return {
        summary: 'Fixed typo in readme',
        addressedIssues: [{ issueId: 'issue-1', resolution: 'Fixed typo' }],
        stepsLog: ['Opened file', 'Fixed typo', 'Saved'],
        codeChanges: ['readme.md'],
      } as WorkerReport;
    });

    const options = {
      maxRounds: 5,
      worktreePath: '/tmp/worktree',
      runReviewer,
      runWorker,
    };

    const result = await runIterationLoop(options);

    // Assert runReviewer was called 2 times
    expect(runReviewer).toHaveBeenCalledTimes(2);

    // Assert runWorker was called 1 time
    expect(runWorker).toHaveBeenCalledTimes(1);

    // Assert the memory objects injected into runReviewer on the second call contain the workerSummary from the first round.
    // The second call is the 2nd invocation (index 1)
    const secondCallOpts = runReviewer.mock.calls[1][0];
    const reviewerMemoryArg = secondCallOpts.reviewerMemory;

    // reviewerMemoryArg is mutated by reference, so it will have length 2 by the end of the run
    expect(reviewerMemoryArg.feedbackLog.length).toBe(2);
    expect(reviewerMemoryArg.feedbackLog[0]).toEqual({
      round: 0,
      issues: [{ id: 'issue-1', description: 'Fix typo' }],
      workerSummary: 'Fixed typo in readme',
    });

    // Also verify final result
    expect(result.finalStatus).toBe('APPROVED');
    expect(result.rounds).toBe(2);
    expect(result.reviewerMemory.feedbackLog.length).toBe(2);
    expect(result.workerMemory.allReviewerIssues.length).toBe(1);
    expect(result.workerMemory.allResolutions.length).toBe(1);
  });

  it('skipInitialReview: round 0 bypasses runReviewer and synthesizes WORK_STARTED', async () => {
    const runReviewer = vi.fn();
    const runWorker = vi.fn();

    // runReviewer is only called from round 1 onwards — return APPROVED immediately
    runReviewer.mockResolvedValueOnce({
      status: 'APPROVED',
      issues: [],
      questions: [],
    } as ReviewerIssueList);

    runWorker.mockResolvedValueOnce({
      summary: 'Created HELLO.txt',
      addressedIssues: [{ issueId: 'initial-task', resolution: 'Created file' }],
      stepsLog: ['Created HELLO.txt'],
      codeChanges: ['HELLO.txt'],
    } as WorkerReport);

    const result = await runIterationLoop({
      maxRounds: 5,
      worktreePath: '/tmp/worktree',
      runReviewer,
      runWorker,
      skipInitialReview: true,
      initialGoal: 'Create HELLO.txt with content "hello world"',
    });

    // runReviewer must NOT be called on round 0
    expect(runReviewer).toHaveBeenCalledTimes(1);
    // runWorker IS called on round 0 with the synthesized WORK_STARTED list
    expect(runWorker).toHaveBeenCalledTimes(1);

    const workerCallOpts = runWorker.mock.calls[0][0];
    const issueList = workerCallOpts.issueList as ReviewerIssueList;
    expect(issueList.status).toBe('WORK_STARTED');
    expect(issueList.issues).toHaveLength(1);
    expect(issueList.issues[0]!.id).toBe('initial-task');
    expect(issueList.issues[0]!.description).toBe('Create HELLO.txt with content "hello world"');

    expect(result.finalStatus).toBe('APPROVED');
  });

  it('skipInitialReview: after round 0 Worker, runReviewer resumes normally from round 1', async () => {
    const runReviewer = vi.fn();
    const runWorker = vi.fn();

    // Round 1 reviewer: still NEEDS_WORK
    runReviewer.mockResolvedValueOnce({
      status: 'NEEDS_WORK',
      issues: [{ id: 'fix-content', description: 'File content is wrong' }],
      questions: [],
    } as ReviewerIssueList);
    // Round 2 reviewer: APPROVED
    runReviewer.mockResolvedValueOnce({
      status: 'APPROVED',
      issues: [],
      questions: [],
    } as ReviewerIssueList);

    runWorker.mockResolvedValue({
      summary: 'Done',
      addressedIssues: [],
      stepsLog: [],
      codeChanges: [],
    } as WorkerReport);

    const result = await runIterationLoop({
      maxRounds: 5,
      worktreePath: '/tmp/worktree',
      runReviewer,
      runWorker,
      skipInitialReview: true,
      initialGoal: 'Create HELLO.txt',
    });

    // round 0: skip reviewer, run worker
    // round 1: run reviewer (NEEDS_WORK), run worker
    // round 2: run reviewer (APPROVED), done
    expect(runReviewer).toHaveBeenCalledTimes(2);
    expect(runWorker).toHaveBeenCalledTimes(2);
    expect(result.finalStatus).toBe('APPROVED');
  });
});

describe('isAbortError', () => {
  it('returns true for DOMException AbortError', () => {
    const err = new DOMException('The operation was aborted', 'AbortError');
    expect(isAbortError(err)).toBe(true);
  });

  it('returns true for Error with "aborted" in message', () => {
    expect(isAbortError(new Error('Request aborted'))).toBe(true);
    expect(isAbortError(new Error('operation was aborted by user'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isAbortError(new Error('Network timeout'))).toBe(false);
    expect(isAbortError(new TypeError('undefined is not a function'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('string error')).toBe(false);
  });
});

describe('runIterationLoop — abort handling', () => {
  /**
   * Asserts that when runWorker throws an AbortError, the loop exits cleanly
   * with finalStatus='ABORTED' instead of propagating the error to the caller.
   *
   * This is the regression test for the crash:
   *   TypeError: Cannot read properties of undefined (reading 'summary')
   * which occurred because the abort caused runWorkerRound to throw, the
   * callback threw before returning a report, and the loop re-threw instead
   * of handling it gracefully.
   */
  it('runWorker throwing an AbortError exits cleanly with ABORTED status', async () => {
    // Mastra resolves output.object as undefined when aborted (not a throw).
    // worker.ts detects this and re-throws a DOMException('AbortError').
    const abortError = new DOMException('Worker stream was aborted.', 'AbortError');
    const runReviewer = vi.fn().mockResolvedValue({
      status: 'NEEDS_WORK',
      issues: [{ id: 'i1', description: 'do something' }],
      questions: [],
    } as ReviewerIssueList);
    const runWorker = vi.fn().mockRejectedValue(abortError);

    const result = await runIterationLoop({
      maxRounds: 5,
      worktreePath: '/tmp/worktree',
      runReviewer,
      runWorker,
    });

    expect(result.finalStatus).toBe('ABORTED');
    expect(runWorker).toHaveBeenCalledTimes(1);
  });

  it('runReviewer throwing an AbortError exits cleanly with ABORTED status', async () => {
    const abortError = new DOMException('Reviewer stream was aborted.', 'AbortError');
    const runReviewer = vi.fn().mockRejectedValue(abortError);
    const runWorker = vi.fn();

    const result = await runIterationLoop({
      maxRounds: 5,
      worktreePath: '/tmp/worktree',
      runReviewer,
      runWorker,
    });

    expect(result.finalStatus).toBe('ABORTED');
    expect(runWorker).not.toHaveBeenCalled();
  });

  it('non-abort errors from runWorker still propagate', async () => {
    const runReviewer = vi.fn().mockResolvedValue({
      status: 'NEEDS_WORK',
      issues: [{ id: 'i1', description: 'do something' }],
      questions: [],
    } as ReviewerIssueList);
    const runWorker = vi.fn().mockRejectedValue(new Error('unexpected network failure'));

    await expect(
      runIterationLoop({
        maxRounds: 5,
        worktreePath: '/tmp/worktree',
        runReviewer,
        runWorker,
      }),
    ).rejects.toThrow('unexpected network failure');
  });
});

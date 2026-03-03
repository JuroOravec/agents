import { z } from 'zod';

/**
 * Zod schema defining the structured contract produced by the Reviewer agent.
 * The Reviewer evaluates the current state of the worktree against the original goal,
 * producing either an APPROVED status or a NEEDS_WORK status with a list of remaining issues.
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */
export const ReviewerIssueListSchema = z.object({
  /**
   * - `NEEDS_WORK`    — Reviewer found issues; Worker should address them.
   * - `APPROVED`      — Reviewer is satisfied; loop exits.
   * - `WORK_STARTED`  — Synthetic status injected by the loop on round 0 when
   *                     `skipInitialReview` is true. The goal is passed directly
   *                     as a single issue so the Worker can start immediately,
   *                     without waiting for a Reviewer evaluation on empty state.
   */
  status: z.enum(['NEEDS_WORK', 'APPROVED', 'WORK_STARTED']),
  issues: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      notes: z.string().optional(),
    }),
  ),
  questions: z.array(z.string()),
  answers: z.array(z.string()).optional(),
  contextNotes: z.string().optional(),
});
export type ReviewerIssueList = z.infer<typeof ReviewerIssueListSchema>;

/**
 * Zod schema defining the structured contract produced by the Worker agent.
 * The Worker reports back what was done, what issues were addressed, and any skipped issues,
 * along with a summary of the code changes made in the isolated worktree.
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */
export const WorkerReportSchema = z.object({
  summary: z.string(),
  addressedIssues: z.array(
    z.object({
      issueId: z.string(),
      resolution: z.string(),
    }),
  ),
  stepsLog: z.array(z.string()),
  codeChanges: z.array(z.string()),
  skippedIssues: z.array(z.string()).optional(),
});
export type WorkerReport = z.infer<typeof WorkerReportSchema>;

/**
 * Cross-round memory state for the Reviewer agent.
 * Owned by the orchestrator loop. Used to prevent the Reviewer from
 * contradicting itself or re-raising issues that have already been resolved.
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */
export interface ReviewerMemory {
  feedbackLog: Array<{
    round: number;
    issues: ReviewerIssueList['issues'];
    workerSummary?: string;
  }>;
}

/**
 * Cross-round memory state for the Worker agent.
 * Owned by the orchestrator loop. Used to provide the Worker with the full history
 * of feedback and what was done, preventing it from re-implementing something previously rejected.
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */
export interface WorkerMemory {
  allReviewerIssues: Array<{
    round: number;
    issues: ReviewerIssueList['issues'];
  }>;
  allResolutions: Array<{
    round: number;
    report: WorkerReport;
  }>;
}

export interface RunReviewerOpts {
  worktreePath: string;
  workerMemory: WorkerMemory;
  reviewerMemory: ReviewerMemory;
  /** Answers from the human to questions raised in the previous round, if any. */
  previousAnswers?: string[];
}

export interface RunWorkerOpts {
  issueList: ReviewerIssueList;
  worktreePath: string;
  workerMemory: WorkerMemory;
}

export interface RunIterationLoopOptions {
  maxRounds: number;
  worktreePath: string;
  runReviewer: (opts: RunReviewerOpts) => Promise<ReviewerIssueList>;
  runWorker: (opts: RunWorkerOpts) => Promise<WorkerReport>;
  onQuestions?: (questions: string[]) => Promise<string[]>;
  /**
   * When true, round 0 skips the Reviewer and instead synthesizes a
   * `WORK_STARTED` issue list from `initialGoal`, jumping straight to
   * the Worker. The Reviewer resumes normally from round 1 onwards.
   *
   * This avoids the Reviewer reporting "no changes found" on an empty
   * worktree when the task has just been handed over.
   */
  skipInitialReview?: boolean;
  /**
   * The human's original task description. Used to construct the synthetic
   * `WORK_STARTED` issue list when `skipInitialReview` is true.
   */
  initialGoal?: string;
}

export interface IterationLoopResult {
  finalStatus: 'NEEDS_WORK' | 'APPROVED' | 'MAX_ROUNDS_REACHED' | 'ABORTED';
  rounds: number;
  reviewerMemory: ReviewerMemory;
  workerMemory: WorkerMemory;
}

/**
 * Returns true if an error is an abort/cancellation error from an AbortSignal.
 * Covers both the standard DOMException 'AbortError' name and any error whose
 * message contains 'aborted' (some runtimes and AI SDK versions use different types).
 */
export function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.name === 'AbortError' ||
      (err as { code?: string }).code === 'ERR_ABORTED' ||
      err.message.toLowerCase().includes('aborted') ||
      err.message.toLowerCase().includes('abort')
    );
  }
  return false;
}

/**
 * The core orchestration loop that coordinates the Reviewer and Worker agents.
 *
 * It runs a state machine up to `maxRounds`:
 * 1. Runs the Reviewer to get a list of issues (or APPROVED).
 * 2. If NEEDS_WORK, runs the Worker to address the issues via Cursor CLI in an isolated worktree.
 * 3. Updates and passes cross-round memory (`ReviewerMemory` and `WorkerMemory`) to maintain context.
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */
export async function runIterationLoop(
  options: RunIterationLoopOptions,
): Promise<IterationLoopResult> {
  const { maxRounds, worktreePath, runReviewer, runWorker, skipInitialReview, initialGoal } =
    options;

  const reviewerMemory: ReviewerMemory = { feedbackLog: [] };
  const workerMemory: WorkerMemory = { allReviewerIssues: [], allResolutions: [] };

  let round = 0;
  let finalStatus: IterationLoopResult['finalStatus'] = 'MAX_ROUNDS_REACHED';
  let pendingAnswers: string[] | undefined;

  while (round < maxRounds) {
    // 1. Run Reviewer — or on round 0 with skipInitialReview, synthesize WORK_STARTED instead.
    let issueList: ReviewerIssueList;
    if (round === 0 && skipInitialReview) {
      issueList = {
        status: 'WORK_STARTED',
        issues: [
          {
            id: 'initial-task',
            description: initialGoal ?? 'Implement the requested task.',
          },
        ],
        questions: [],
      };
    } else {
      try {
        issueList = await runReviewer({
          worktreePath,
          workerMemory,
          reviewerMemory,
          previousAnswers: pendingAnswers,
        });
      } catch (err) {
        if (isAbortError(err)) {
          finalStatus = 'ABORTED';
          break;
        }
        throw err;
      }
    }
    pendingAnswers = undefined;

    // Push pending log
    reviewerMemory.feedbackLog.push({
      round,
      issues: issueList.issues,
    });

    if (issueList.status === 'APPROVED') {
      finalStatus = 'APPROVED';
      break;
    }

    // WORK_STARTED and NEEDS_WORK both proceed to the Worker.

    // 1.5 Pause for clarification if needed
    if (issueList.questions.length > 0 && options.onQuestions) {
      pendingAnswers = await options.onQuestions(issueList.questions);
      issueList.answers = pendingAnswers;
    }

    // 2. Run Worker
    let report: WorkerReport;
    try {
      report = await runWorker({ issueList, worktreePath, workerMemory });
    } catch (err) {
      if (isAbortError(err)) {
        finalStatus = 'ABORTED';
        break;
      }
      throw err;
    }

    // Update the workerSummary on the current feedbackLog entry
    const currentLog = reviewerMemory.feedbackLog.find((log) => log.round === round);
    if (currentLog) {
      currentLog.workerSummary = report.summary;
    }

    // Update worker memory
    workerMemory.allReviewerIssues.push({
      round,
      issues: issueList.issues,
    });
    workerMemory.allResolutions.push({
      round,
      report,
    });

    round++;
  }

  return {
    finalStatus,
    rounds: finalStatus === 'APPROVED' ? round + 1 : round,
    reviewerMemory,
    workerMemory,
  };
}

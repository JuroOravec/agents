/**
 * Runs `npm run check:agent` in a given directory (typically the worktree root).
 * Returns a structured result for the Reviewer or for direct hand-off to the Worker.
 *
 * When validation fails, we bypass the Reviewer and synthesize a NEEDS_WORK issue
 * list from the check output — no LLM call, faster feedback to the Worker.
 *
 * @see src/engine/index.ts — the validation engine
 * @see docs/tdd.md — TDD and the Validation Engine
 */

import { exec } from 'node:child_process';

import type { ReviewerIssueList } from './iteration-loop.js';

export type CheckAgentResult =
  | { status: 'PASSED' }
  | { status: 'FAILED'; phase: string; command: string; details: string };

function parseLastJsonLine(output: string): CheckAgentResult | null {
  const lines = output.trim().split('\n').filter(Boolean);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) return null;
  try {
    const parsed = JSON.parse(lastLine) as {
      status?: string;
      phase?: string;
      command?: string;
      details?: string;
    };
    if (parsed.status === 'PASSED') return { status: 'PASSED' };
    if (parsed.status === 'FAILED' && parsed.phase && parsed.command !== undefined) {
      return {
        status: 'FAILED',
        phase: parsed.phase,
        command: parsed.command,
        details: parsed.details ?? 'No details',
      };
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/**
 * Runs `npm run check:agent` in the given directory.
 * Returns PASSED or FAILED with phase, command, and details.
 *
 * Uses the callback form of exec so we capture stdout/stderr even when the
 * command exits non-zero (the engine prints JSON to stdout on failure).
 *
 * @param worktreePath - Directory to run the check in (worktree root).
 * @param timeoutMs - Max time to wait (default 120s for full lint + build + tests).
 */
export function runCheckAgent(
  worktreePath: string,
  timeoutMs = 120_000,
): Promise<CheckAgentResult> {
  return new Promise((resolve) => {
    exec(
      'npm run check:agent',
      { cwd: worktreePath, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
      // eslint-disable-next-line max-params -- Node.js exec callback signature (err, stdout, stderr)
      (err, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();

        const parsed = parseLastJsonLine(output);
        if (parsed) {
          resolve(parsed);
          return;
        }

        if (err) {
          resolve({
            status: 'FAILED',
            phase: 'Unknown',
            command: 'npm run check:agent',
            details: output || (err instanceof Error ? err.message : String(err)),
          });
        } else {
          resolve({ status: 'PASSED' });
        }
      },
    );
  });
}

/**
 * Produces a synthetic ReviewerIssueList from a failed check result.
 * Used to bypass the Reviewer and send validation failures directly to the Worker.
 */
export function synthesizeIssueListFromCheckFailure(
  result: CheckAgentResult & { status: 'FAILED' },
): ReviewerIssueList {
  return {
    status: 'NEEDS_WORK',
    issues: [
      {
        id: 'validation-failed',
        description: `Validation (npm run check:agent) failed at ${result.phase}.\nCommand: ${result.command}\n\nDetails:\n${result.details}`,
        notes:
          'Fix the validation failures and ensure `npm run check:agent` passes before reporting back.',
      },
    ],
    questions: [],
  };
}

export type RunCheckResult =
  | { action: 'call_reviewer'; checkResult: CheckAgentResult }
  | { action: 'bypass_to_worker'; issueList: ReviewerIssueList };

/**
 * Runs check:agent and decides whether to call the Reviewer or bypass to the Worker.
 * When validation fails, bypasses the Reviewer and returns a synthetic issue list.
 */
export async function runCheckAndDecide(
  worktreePath: string,
  timeoutMs = 120_000,
): Promise<RunCheckResult> {
  const checkResult = await runCheckAgent(worktreePath, timeoutMs);
  if (checkResult.status === 'PASSED') {
    return { action: 'call_reviewer', checkResult };
  }
  return {
    action: 'bypass_to_worker',
    issueList: synthesizeIssueListFromCheckFailure(checkResult),
  };
}

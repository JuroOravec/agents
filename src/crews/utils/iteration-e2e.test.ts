import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCodebaseBackend } from '../../lib/codebase-backend/index.js';
import { cleanupWorktree, createWorktree } from '../../utils/git-worktree';
import { type ReviewerIssueList, runIterationLoop, type WorkerReport } from './iteration-loop';

const JOB_ID = 'e2e-iteration-test';

describe('e2e iteration loop (Live Fire)', () => {
  let worktreePath: string;

  beforeAll(async () => {
    // We create a worktree for the test
    worktreePath = await createWorktree(JOB_ID);

    // Ensure src directory exists
    const srcDir = join(worktreePath, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    // Create a deliberately broken file inside the worktree
    const codePath = join(srcDir, 'math.ts');
    await fs.writeFile(
      codePath,
      'export function add(a: number, b: number) { return a - b; } // BUG!',
    );

    // Create a simple test file that will fail
    const testPath = join(srcDir, 'math.test.ts');
    await fs.writeFile(
      testPath,
      `import { expect, test } from 'vitest';
import { add } from './math';

test('add', () => {
  expect(add(1, 2)).toBe(3);
});
`,
    );
  });

  afterAll(async () => {
    // Ensure we clean up the worktree when done
    await cleanupWorktree(JOB_ID);
  });

  // Skipped by default because it hits the real cursor CLI or native coder model
  // Run manually with: npx vitest run src/crews/utils/iteration-e2e.test.ts -t "Live Fire"
  it.skip('should fix the broken add function using the coder model', async () => {
    const codebaseBackend = createCodebaseBackend(worktreePath);

    let roundCounter = 0;

    const result = await runIterationLoop({
      maxRounds: 3,
      worktreePath,
      runReviewer: async () => {
        // Mocking the Reviewer: Round 0 says "needs work", Round 1+ says "approved"
        if (roundCounter === 0) {
          roundCounter++;
          return {
            status: 'NEEDS_WORK',
            issues: [
              {
                id: '1',
                description:
                  'The add function in math.ts is broken. It subtracts instead of adding. Fix it so that the tests in math.test.ts pass.',
              },
            ],
            questions: [],
          } as ReviewerIssueList;
        }

        return {
          status: 'APPROVED',
          issues: [],
          questions: [],
        } as ReviewerIssueList;
      },
      runWorker: async ({ issueList }) => {
        const issuesText = issueList.issues.map((i) => i.description).join('\n');

        const output = await codebaseBackend.edit(
          'Fix the issues identified by the reviewer',
          `Issues:\n${issuesText}`,
        );
        console.log('Worker Output:', output);

        return {
          summary: `Worker completed task:\n${output}`,
          addressedIssues: issueList.issues.map((i) => ({
            issueId: i.id,
            resolution: 'Attempted fix with AI',
          })),
          stepsLog: ['Delegated to coder model'],
          codeChanges: ['math.ts'],
        } as WorkerReport;
      },
    });

    // Loop should reach APPROVED status
    expect(result.finalStatus).toBe('APPROVED');

    // Verify the test inside the worktree actually passes
    // This proves the AI actually fixed the code, didn't just pretend
    expect(() => {
      execSync('npx vitest run src/math.test.ts', { cwd: worktreePath });
    }).not.toThrow();
  }, 180000); // 3 minutes timeout since AI can take a while
});

import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanupWorktree, commitWorktree, createWorktree, getDiff } from './git-worktree';

const execAsync = promisify(exec);

describe('Worktree Manager', () => {
  const jobId = 'test-job-123';
  let worktreePath: string;

  beforeEach(async () => {
    // Ensure cleanup from previous runs
    await cleanupWorktree(jobId);

    // Create a known base branch for consistent testing
    try {
      await execAsync('git branch test-base-branch');
    } catch {
      // Ignore if already exists
    }
  });

  afterEach(async () => {
    await cleanupWorktree(jobId);
    try {
      await execAsync('git branch -D test-base-branch');
    } catch {
      // Ignore
    }
  });

  it('creates, diffs, and cleans up a worktree', async () => {
    // 1. Create a worktree
    worktreePath = await createWorktree(jobId, 'test-base-branch');

    expect(existsSync(worktreePath)).toBe(true);

    // 2. Write a dummy file into the worktree folder
    const dummyFileName = 'test-dummy-file.txt';
    const dummyFilePath = join(worktreePath, dummyFileName);
    await writeFile(dummyFilePath, 'dummy content');

    // 3. Assert the file does not exist in the main repository root
    const rootDummyFilePath = join(process.cwd(), dummyFileName);
    expect(existsSync(rootDummyFilePath)).toBe(false);

    // 4. Call getDiff() and assert it returns the unified diff showing the file
    const diff = await getDiff(worktreePath, 'test-base-branch');
    expect(diff).toContain('diff --git');
    expect(diff).toContain(dummyFileName);
    expect(diff).toContain('+dummy content');

    // 5. Call cleanupWorktree() and assert the folder is removed
    await cleanupWorktree(jobId);
    expect(existsSync(worktreePath)).toBe(false);
  });

  it('commits changes and optionally preserves the branch on cleanup', async () => {
    // 1. Create a worktree
    worktreePath = await createWorktree(jobId, 'test-base-branch');

    // 2. Write a file
    const dummyFileName = 'commit-test.txt';
    const dummyFilePath = join(worktreePath, dummyFileName);
    await writeFile(dummyFilePath, 'file to commit');

    // 3. Commit the changes
    await commitWorktree(worktreePath, 'test commit: added dummy file');

    // 4. Verify commit exists on the branch
    const branchName = `crew/${jobId}`;
    const { stdout: logOutput } = await execAsync(`git log -1 --format=%s ${branchName}`);
    expect(logOutput.trim()).toBe('test commit: added dummy file');

    // 5. Cleanup the worktree but KEEP the branch
    await cleanupWorktree(jobId, false);

    // 6. Verify worktree folder is gone
    expect(existsSync(worktreePath)).toBe(false);

    // 7. Verify branch STILL exists
    const { stdout: branchOutput } = await execAsync(`git branch --list ${branchName}`);
    expect(branchOutput.trim()).toContain(branchName);

    // 8. Finally clean up the branch too
    await cleanupWorktree(jobId, true);
    const { stdout: finalBranchOutput } = await execAsync(`git branch --list ${branchName}`);
    expect(finalBranchOutput.trim()).toBe('');
  });
});

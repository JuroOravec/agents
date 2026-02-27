import { exec } from 'node:child_process';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Creates a git worktree for isolated agent execution.
 */
export async function createWorktree(jobId: string, baseBranch?: string): Promise<string> {
  const branchName = `crew/${jobId}`;
  const relativePath = join('.worktrees', `crew-${jobId}`);
  const worktreeDir = resolve(relativePath);

  const base = baseBranch ? ` ${baseBranch}` : '';
  await execAsync(`git worktree add -b ${branchName} "${worktreeDir}"${base}`);

  return worktreeDir;
}

/**
 * Gets the git diff of the worktree against the base branch.
 */
export async function getDiff(worktreePath: string, baseBranch: string = 'main'): Promise<string> {
  try {
    // Stage all changes so that untracked files are included in the diff
    await execAsync('git add .', { cwd: worktreePath });
    // Get the diff against the base branch
    const { stdout } = await execAsync(`git diff ${baseBranch}`, { cwd: worktreePath });
    return stdout;
  } catch (error: unknown) {
    const err = error as { stdout?: string };
    if (err.stdout !== undefined) {
      return err.stdout;
    }
    throw error;
  }
}

/**
 * Commits the current staged and unstaged changes in the worktree.
 */
export async function commitWorktree(worktreePath: string, message: string): Promise<void> {
  await execAsync('git add .', { cwd: worktreePath });
  try {
    await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: worktreePath });
  } catch (error: unknown) {
    const err = error as { stdout?: string };
    if (
      typeof err.stdout === 'string' &&
      (err.stdout.includes('nothing to commit') || err.stdout.includes('clean'))
    ) {
      return;
    }
    throw error;
  }
}

/**
 * Merges the worktree branch into the current branch from the given repo root.
 * Merges ALL commits on the worktree branch (including any commits made during
 * the session, even if the loop aborted). Fails if the main working directory
 * has uncommitted changes or if there are merge conflicts.
 *
 * @param jobId - Job ID (branch name is crew/<jobId>).
 * @param repoRoot - Path to the main working directory (where to run git merge).
 * @returns True if merge succeeded, false otherwise (e.g. uncommitted changes, conflicts).
 */
export async function mergeWorktreeBranch(
  jobId: string,
  repoRoot: string,
): Promise<{ ok: boolean; error?: string }> {
  const branchName = `crew/${jobId}`;
  try {
    await execAsync(`git merge --no-edit ${branchName}`, {
      cwd: repoRoot,
    });
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Abort if we left the repo in a conflicted state
    try {
      await execAsync('git merge --abort', { cwd: repoRoot });
    } catch {
      // Ignore if merge wasn't in progress
    }
    return { ok: false, error: msg };
  }
}

/**
 * Cleans up the git worktree and optionally the associated branch.
 */
export async function cleanupWorktree(jobId: string, deleteBranch: boolean = true): Promise<void> {
  const branchName = `crew/${jobId}`;
  const relativePath = join('.worktrees', `crew-${jobId}`);
  const worktreeDir = resolve(relativePath);

  try {
    await execAsync(`git worktree remove --force "${worktreeDir}"`);
  } catch {
    // Ignore if worktree is already removed or missing
  }

  if (deleteBranch) {
    try {
      await execAsync(`git branch -D ${branchName}`);
    } catch {
      // Ignore if branch doesn't exist
    }
  }
}

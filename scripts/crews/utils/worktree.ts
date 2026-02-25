import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const execAsync = promisify(exec);

export async function createWorktree(jobId: string, baseBranch?: string): Promise<string> {
  const branchName = `crew/${jobId}`;
  const relativePath = join('.worktrees', `crew-${jobId}`);
  const worktreeDir = resolve(relativePath);
  
  const base = baseBranch ? ` ${baseBranch}` : '';
  await execAsync(`git worktree add -b ${branchName} "${worktreeDir}"${base}`);
  
  return worktreeDir;
}

export async function getDiff(worktreePath: string, baseBranch: string = 'main'): Promise<string> {
  try {
    // Stage all changes so that untracked files are included in the diff
    await execAsync('git add .', { cwd: worktreePath });
    // Get the diff against the base branch
    const { stdout } = await execAsync(`git diff ${baseBranch}`, { cwd: worktreePath });
    return stdout;
  } catch (error: any) {
    if (error.stdout !== undefined) {
        return error.stdout;
    }
    throw error;
  }
}

export async function cleanupWorktree(jobId: string): Promise<void> {
  const branchName = `crew/${jobId}`;
  const relativePath = join('.worktrees', `crew-${jobId}`);
  const worktreeDir = resolve(relativePath);

  try {
    await execAsync(`git worktree remove --force "${worktreeDir}"`);
  } catch (error) {
    // Ignore if worktree is already removed or missing
  }
  
  try {
    await execAsync(`git branch -D ${branchName}`);
  } catch (error) {
    // Ignore if branch doesn't exist
  }
}

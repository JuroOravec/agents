import type * as ChildProcess from 'node:child_process';
import { promisify } from 'node:util';

import * as clack from '@clack/prompts';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import * as iterationLoop from '../src/crews/utils/iteration-loop.js';
import * as worktree from '../src/utils/git-worktree.js';
import { runCli } from './demo-worker.js';

// @clack/prompts must be mocked at the module level to replace the interactive
// prompt that would otherwise block on real stdin.
const mockClackText = vi.fn();
const mockClackIsCancel = vi.fn().mockReturnValue(false);
vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    step: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    message: vi.fn(),
  },
  note: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  cancel: vi.fn(),
  text: (...args: unknown[]) => mockClackText(...args),
  isCancel: (...args: unknown[]) => mockClackIsCancel(...args),
}));

// Mock the dependencies so we don't actually create worktrees or call LLMs
vi.mock('./utils/iteration-loop', () => ({
  runIterationLoop: vi.fn(),
}));

vi.mock('../utils/git-worktree', () => ({
  createWorktree: vi.fn(),
  cleanupWorktree: vi.fn(),
  commitWorktree: vi.fn(),
  mergeWorktreeBranch: vi.fn(),
}));

vi.mock('../mastra/agents/reviewer', () => ({
  runReviewerRound: vi.fn(),
}));

vi.mock('./worker', () => ({
  runWorkerRound: vi.fn(),
}));

const mockRunSkillDiscovery = vi.fn();
vi.mock('./skill-discovery.js', () => ({
  runSkillDiscovery: (...args: unknown[]) => mockRunSkillDiscovery(...args),
}));

const mockExecFile = vi.hoisted(() => vi.fn());
// mockExec simulates check:agent PASSED by default
// exec mock matches child_process.exec(cmd, opts, callback) — 3 params required by Node API

const mockExec = vi.hoisted(() =>
  vi.fn(
    (
      cmd: string,
      opts: unknown,
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, '{"status":"PASSED"}', '');
    },
  ),
);

vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof ChildProcess>();
  const execFileMock = Object.assign(mockExecFile, {
    [promisify.custom]: (file: string, args: string[]) => {
      mockExecFile(file, args);
      if (Array.isArray(args) && args.includes('create')) {
        return Promise.resolve({ stdout: 'https://github.com/owner/repo/issues/42', stderr: '' });
      }
      return Promise.resolve({ stdout: '[]', stderr: '' });
    },
  });
  return {
    ...orig,
    execFile: execFileMock,
    exec: mockExec,
  };
});

describe('worker CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClackText.mockReset();
    mockClackIsCancel.mockReturnValue(false);

    // Default: check:agent passes (exec callback: cmd, opts, callback)

    mockExec.mockImplementation(
      (
        cmd: string,
        opts: unknown,
        callback: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, '{"status":"PASSED"}', '');
      },
    );

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(worktree.createWorktree).mockResolvedValue('/mock/worktree/path');
    vi.mocked(worktree.commitWorktree).mockResolvedValue();
    vi.mocked(worktree.cleanupWorktree).mockResolvedValue();

    vi.mocked(iterationLoop.runIterationLoop).mockResolvedValue({
      finalStatus: 'APPROVED',
      rounds: 1,
      reviewerMemory: { feedbackLog: [] },
      workerMemory: { allReviewerIssues: [], allResolutions: [] },
    });

    // Skill discovery: by default, similar skill exists (no gh issue create)
    mockRunSkillDiscovery.mockResolvedValue({
      skillExists: true,
      existingSkillPath: '.cursor/skills/act/dev/SKILL.md',
      reasoning: 'Found match.',
    });
  });

  it('throws an error if no --goal is provided', async () => {
    await expect(runCli([])).rejects.toThrow('Missing required argument: --goal');
  });

  it('exits cleanly (process.exit 0) when --help is passed without --goal', async () => {
    await expect(runCli(['--help'])).rejects.toThrow('process.exit unexpectedly called with "0"');
  });

  // --no-interactive (single-run) tests

  describe('--no-interactive mode', () => {
    it('runs the full iteration loop and cleans up the worktree on APPROVED', async () => {
      await runCli(['--goal', 'Fix the auth bug', '--no-interactive']);

      expect(worktree.createWorktree).toHaveBeenCalledOnce();
      const jobIdArg = vi.mocked(worktree.createWorktree).mock.calls[0][0];
      expect(jobIdArg).toMatch(/^worker-\d+$/);

      expect(iterationLoop.runIterationLoop).toHaveBeenCalledOnce();
      const loopOptions = vi.mocked(iterationLoop.runIterationLoop).mock.calls[0][0];
      expect(loopOptions.maxRounds).toBe(3);
      expect(loopOptions.worktreePath).toBe('/mock/worktree/path');

      expect(worktree.commitWorktree).toHaveBeenCalledWith(
        '/mock/worktree/path',
        'worker: Fix the auth bug',
      );

      // Cleanup worktree directory but NOT delete the branch because it was APPROVED
      expect(worktree.cleanupWorktree).toHaveBeenCalledWith(jobIdArg, false);
    });

    it('deletes the branch on failure (NEEDS_WORK)', async () => {
      vi.mocked(iterationLoop.runIterationLoop).mockResolvedValue({
        finalStatus: 'NEEDS_WORK',
        rounds: 3,
        reviewerMemory: { feedbackLog: [] },
        workerMemory: { allReviewerIssues: [], allResolutions: [] },
      });

      await runCli(['--goal', 'Fail to fix bug', '--no-interactive']);

      const jobIdArg = vi.mocked(worktree.createWorktree).mock.calls[0][0];
      expect(worktree.cleanupWorktree).toHaveBeenCalledWith(jobIdArg, true);
    });

    it('respects --max-rounds and --keep-worktree', async () => {
      await runCli(['-g', 'Test arg parsing', '-m', '5', '--keep-worktree', '--no-interactive']);

      const loopOptions = vi.mocked(iterationLoop.runIterationLoop).mock.calls[0][0];
      expect(loopOptions.maxRounds).toBe(5);

      expect(worktree.cleanupWorktree).not.toHaveBeenCalled();
    });

    it('merges and deletes branch when --merge and APPROVED', async () => {
      vi.mocked(worktree.mergeWorktreeBranch).mockResolvedValue({ ok: true });

      await runCli(['--goal', 'Fix auth', '--no-interactive', '--merge']);

      const jobIdArg = vi.mocked(worktree.createWorktree).mock.calls[0][0];
      expect(worktree.mergeWorktreeBranch).toHaveBeenCalledWith(jobIdArg, expect.any(String));
      expect(worktree.cleanupWorktree).toHaveBeenCalledWith(jobIdArg, true);
    });

    it('keeps branch when --merge fails (e.g. uncommitted changes in main)', async () => {
      vi.mocked(worktree.mergeWorktreeBranch).mockResolvedValue({
        ok: false,
        error: 'error: cannot merge: you have uncommitted changes',
      });

      await runCli(['--goal', 'Fix auth', '--no-interactive', '--merge']);

      const jobIdArg = vi.mocked(worktree.createWorktree).mock.calls[0][0];
      expect(worktree.mergeWorktreeBranch).toHaveBeenCalledWith(jobIdArg, expect.any(String));
      expect(worktree.cleanupWorktree).toHaveBeenCalledWith(jobIdArg, false);
    });
  });

  // check:agent bypass behavior

  describe('runReviewer callback — check:agent bypass', () => {
    /** Runs the CLI and extracts the runReviewer callback from the loop options. */
    async function getRunReviewer() {
      await runCli(['--goal', 'Fix bug', '--no-interactive']);
      const loopOptions = vi.mocked(iterationLoop.runIterationLoop).mock.calls[0][0];
      return loopOptions.runReviewer as Mock;
    }

    const stubMemory = {
      workerMemory: { allReviewerIssues: [], allResolutions: [] },
      reviewerMemory: { feedbackLog: [] },
    };

    it('calls the Reviewer when check:agent passes', async () => {
      const { runReviewerRound } = await import('../src/mastra/agents/reviewer.js');
      vi.mocked(runReviewerRound).mockResolvedValue({
        status: 'APPROVED',
        issues: [],
        questions: [],
      });

      mockExec.mockImplementation(
        (cmd: string, opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, '{"status":"PASSED"}', '');
        },
      );

      const runReviewer = await getRunReviewer();
      const result = await runReviewer({
        worktreePath: '/mock/worktree',
        workerMemory: stubMemory.workerMemory,
        reviewerMemory: stubMemory.reviewerMemory,
      });

      expect(runReviewerRound).toHaveBeenCalledOnce();
      expect(result.status).toBe('APPROVED');
    });

    it('bypasses the Reviewer and returns NEEDS_WORK when check:agent fails', async () => {
      const { runReviewerRound } = await import('../src/mastra/agents/reviewer.js');

      mockExec.mockImplementation(
        (cmd: string, opts: unknown, cb: (err: Error, stdout: string, stderr: string) => void) => {
          cb(
            new Error('fail'),
            '{"status":"FAILED","phase":"Phase 2: Lint","command":"npm run lint","details":"unused var"}',
            '',
          );
        },
      );

      const runReviewer = await getRunReviewer();
      const result = await runReviewer({
        worktreePath: '/mock/worktree',
        workerMemory: stubMemory.workerMemory,
        reviewerMemory: stubMemory.reviewerMemory,
      });

      expect(runReviewerRound).not.toHaveBeenCalled();
      expect(result.status).toBe('NEEDS_WORK');
      expect(result.issues[0].id).toBe('validation-failed');
      expect(result.issues[0].description).toContain('Phase 2: Lint');
    });
  });

  // --no-thoughts / thought-streaming tests

  describe('--no-thoughts flag', () => {
    it('defaults to showing thoughts (showThoughts=true is reflected via callbacks receiving onThought)', async () => {
      mockClackText.mockResolvedValueOnce('');
      await runCli(['--goal', 'Test thoughts default']);

      // The loop is called — we don't assert the internal callback shape here;
      // covered by reviewer.ts / worker.ts unit tests. Just ensure CLI runs without error.
      expect(iterationLoop.runIterationLoop).toHaveBeenCalledOnce();
    });

    it('accepts --no-thoughts without error', async () => {
      mockClackText.mockResolvedValueOnce('');
      await expect(runCli(['--goal', 'Test no-thoughts', '--no-thoughts'])).resolves.not.toThrow();

      expect(iterationLoop.runIterationLoop).toHaveBeenCalledOnce();
    });
  });

  // interactive mode tests

  describe('interactive mode (default)', () => {
    it('uses Infinity as default maxRounds', async () => {
      // Empty string → clack text returns '' → treated as quit
      mockClackText.mockResolvedValueOnce('');

      await runCli(['--goal', 'Fix something']);

      const loopOptions = vi.mocked(iterationLoop.runIterationLoop).mock.calls[0][0];
      expect(loopOptions.maxRounds).toBe(Infinity);
    });

    it('commits after each task and keeps the branch on session end', async () => {
      mockClackText.mockResolvedValueOnce('');

      await runCli(['--goal', 'First task']);

      expect(worktree.commitWorktree).toHaveBeenCalledOnce();
      // On quit, cleanup is called with deleteBranch=false (branch always preserved)
      expect(worktree.cleanupWorktree).toHaveBeenCalledWith(
        expect.stringMatching(/^worker-\d+$/),
        false,
      );
    });

    it('runs a second task when user provides one before quitting', async () => {
      mockClackText.mockResolvedValueOnce('Second task').mockResolvedValueOnce('');

      await runCli(['--goal', 'First task']);

      expect(iterationLoop.runIterationLoop).toHaveBeenCalledTimes(2);
      expect(worktree.commitWorktree).toHaveBeenCalledTimes(2);
    });
  });

  // Post-approval skill discovery integration

  describe('post-approval skill discovery', () => {
    it('calls runSkillDiscovery when loop returns APPROVED', async () => {
      await runCli(['--goal', 'Fix auth bug', '--no-interactive']);

      expect(mockRunSkillDiscovery).toHaveBeenCalledOnce();
      const call = mockRunSkillDiscovery.mock.calls[0][0];
      expect(call.goal).toBe('Fix auth bug');
      expect(call.worktreePath).toBe('/mock/worktree/path');
      expect(call.workerMemory).toEqual({ allReviewerIssues: [], allResolutions: [] });
      expect(call.reviewerMemory).toEqual({ feedbackLog: [] });
      expect(call.existingSkillCandidateIssues).toEqual([]);
    });

    it('creates GitHub issue via gh when no similar skill exists and prints issue URL', async () => {
      mockRunSkillDiscovery.mockResolvedValueOnce({
        skillExists: false,
        reasoning: 'No match.',
        suggestedIssue: {
          title: 'Skill candidate: Add foo-bar workflow',
          body: '## Files changed\n- src/foo.ts',
        },
      });

      await runCli(['--goal', 'Implement foo-bar', '--no-interactive']);

      expect(mockExecFile).toHaveBeenCalledWith('gh', [
        'issue',
        'create',
        '--title',
        'Skill candidate: Add foo-bar workflow',
        '--body',
        '## Files changed\n- src/foo.ts',
        '--label',
        'skill-candidate',
      ]);
      expect(clack.log.success).toHaveBeenCalledWith(
        expect.stringContaining('https://github.com/owner/repo/issues/42'),
      );
    });

    it('does not call gh issue create when similar skill exists', async () => {
      mockRunSkillDiscovery.mockResolvedValueOnce({
        skillExists: true,
        existingSkillPath: '.cursor/skills/act/dev/SKILL.md',
        reasoning: 'Found match.',
      });

      await runCli(['--goal', 'Update docs', '--no-interactive']);

      const createCalls = vi
        .mocked(mockExecFile)
        .mock.calls.filter((c) => Array.isArray(c[1]) && (c[1] as string[]).includes('create'));
      expect(createCalls).toHaveLength(0);
    });

    it('skips skill discovery when --no-discovery is passed', async () => {
      await runCli(['--goal', 'Fix something', '--no-interactive', '--no-discovery']);

      expect(mockRunSkillDiscovery).not.toHaveBeenCalled();
      const createCalls = vi
        .mocked(mockExecFile)
        .mock.calls.filter((c) => Array.isArray(c[1]) && (c[1] as string[]).includes('create'));
      const listCalls = vi
        .mocked(mockExecFile)
        .mock.calls.filter((c) => Array.isArray(c[1]) && (c[1] as string[]).includes('list'));
      expect(createCalls).toHaveLength(0);
      expect(listCalls).toHaveLength(0);
    });

    it('does not call gh issue create when relevant skill-candidate issue exists', async () => {
      mockRunSkillDiscovery.mockResolvedValueOnce({
        skillExists: false,
        existingIssueMatch: { number: 99, url: 'https://github.com/owner/repo/issues/99' },
        reasoning: 'Issue #99 already covers this pattern.',
      });

      await runCli(['--goal', 'Implement duplicate pattern', '--no-interactive']);

      const createCalls = vi
        .mocked(mockExecFile)
        .mock.calls.filter((c) => Array.isArray(c[1]) && (c[1] as string[]).includes('create'));
      expect(createCalls).toHaveLength(0);
      expect(clack.log.success).toHaveBeenCalledWith(expect.stringContaining('#99'));
      expect(clack.log.success).toHaveBeenCalledWith(
        expect.stringContaining('https://github.com/owner/repo/issues/99'),
      );
    });
  });
});

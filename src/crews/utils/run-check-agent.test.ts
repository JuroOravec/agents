/**
 * Unit tests for runCheckAgent (run-check-agent.ts).
 */

import { exec } from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

// Dynamic import after mock so we get the mocked exec
async function loadRunCheckAgent() {
  const mod = await import('./run-check-agent.js');
  return mod.runCheckAgent;
}

describe('runCheckAgent', () => {
  beforeEach(() => {
    vi.mocked(exec).mockReset();
  });

  it('returns PASSED when check:agent exits 0 and outputs PASSED JSON', async () => {
    vi.mocked(exec).mockImplementation(
      // eslint-disable-next-line max-params -- matches child_process.exec(cmd, opts, callback)
      (cmd, opts, callback) => {
        callback(null, '{"status":"PASSED"}\n', '');
        return {} as ReturnType<typeof exec>;
      },
    );

    const runCheckAgent = await loadRunCheckAgent();
    const result = await runCheckAgent('/tmp/worktree');

    expect(result).toEqual({ status: 'PASSED' });
  });

  it('returns FAILED with phase, command, details when check:agent fails', async () => {
    const stdout = [
      'some lint output...',
      '{"status":"FAILED","phase":"Phase 2: Lint","command":"npm run lint","details":"error: unused var"}',
    ].join('\n');

    vi.mocked(exec).mockImplementation(
      // eslint-disable-next-line max-params -- matches child_process.exec(cmd, opts, callback)
      (cmd, opts, callback) => {
        const err = new Error('Command failed');
        // exec calls callback(err, stdout, stderr) even on failure — we capture stdout
        callback(err, stdout, '');
        return {} as ReturnType<typeof exec>;
      },
    );

    const runCheckAgent = await loadRunCheckAgent();
    const result = await runCheckAgent('/tmp/worktree');

    expect(result).toEqual({
      status: 'FAILED',
      phase: 'Phase 2: Lint',
      command: 'npm run lint',
      details: 'error: unused var',
    });
  });

  it('parses FAILED from last line of stdout on success exit (edge case)', async () => {
    // If exec succeeds but output contains FAILED - shouldn't happen in practice
    vi.mocked(exec).mockImplementation(
      // eslint-disable-next-line max-params -- matches child_process.exec(cmd, opts, callback)
      (cmd, opts, callback) => {
        const stdout = 'other\n{"status":"FAILED","phase":"X","command":"y","details":"z"}\n';
        callback(null, stdout, '');
        return {} as ReturnType<typeof exec>;
      },
    );

    const runCheckAgent = await loadRunCheckAgent();
    const result = await runCheckAgent('/tmp/worktree');

    expect(result.status).toBe('FAILED');
    expect((result as { phase: string }).phase).toBe('X');
  });
});

describe('synthesizeIssueListFromCheckFailure', () => {
  it('produces NEEDS_WORK issue list with validation details', async () => {
    const mod = await import('./run-check-agent.js');
    const result = mod.synthesizeIssueListFromCheckFailure({
      status: 'FAILED',
      phase: 'Phase 2: Lint',
      command: 'npm run lint',
      details: 'error: unused var',
    });

    expect(result).toEqual({
      status: 'NEEDS_WORK',
      issues: [
        {
          id: 'validation-failed',
          description: expect.stringContaining('Phase 2: Lint'),
          notes: expect.stringContaining('check:agent'),
        },
      ],
      questions: [],
    });
  });
});

describe('runCheckAndDecide', () => {
  beforeEach(() => {
    vi.mocked(exec).mockReset();
  });

  it('returns bypass_to_worker when check fails', async () => {
    vi.mocked(exec).mockImplementation(
      // eslint-disable-next-line max-params -- matches child_process.exec(cmd, opts, callback)
      (cmd, opts, callback) => {
        callback(
          new Error('fail'),
          '{"status":"FAILED","phase":"Lint","command":"lint","details":"err"}',
          '',
        );
        return {} as ReturnType<typeof exec>;
      },
    );

    const mod = await import('./run-check-agent.js');
    const decision = await mod.runCheckAndDecide('/tmp/worktree');

    expect(decision.action).toBe('bypass_to_worker');
    expect(decision.issueList.status).toBe('NEEDS_WORK');
    expect(decision.issueList.issues[0].id).toBe('validation-failed');
  });

  it('returns call_reviewer when check passes', async () => {
    vi.mocked(exec).mockImplementation(
      // eslint-disable-next-line max-params -- matches child_process.exec(cmd, opts, callback)
      (cmd, opts, callback) => {
        callback(null, '{"status":"PASSED"}', '');
        return {} as ReturnType<typeof exec>;
      },
    );

    const mod = await import('./run-check-agent.js');
    const decision = await mod.runCheckAndDecide('/tmp/worktree');

    expect(decision.action).toBe('call_reviewer');
    expect(decision.checkResult.status).toBe('PASSED');
  });
});

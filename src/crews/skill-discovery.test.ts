/**
 * Unit tests for runSkillDiscovery (skill-discovery.ts).
 *
 * Verifies the structured output contract, onThought/onEvent wiring,
 * and correct extraction of SkillDiscoveryResult (skillExists vs suggestedIssue).
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runSkillDiscovery, type SkillDiscoveryResult } from './skill-discovery.js';

vi.mock('@mastra/core/agent', () => ({ Agent: vi.fn() }));
vi.mock('../models.js', () => ({ smartModel: {} }));
vi.mock('./utils/worktree.js', () => ({
  getDiff: vi.fn().mockResolvedValue('diff --git a/src/foo.ts b/src/foo.ts\n'),
}));

function makeFakeOutput(deltas: string[], result: SkillDiscoveryResult) {
  const fullStream = new ReadableStream({
    start(controller) {
      for (const delta of deltas) {
        controller.enqueue({ type: 'text-delta', payload: { text: delta, id: 'x' } });
      }
      controller.close();
    },
  });
  return {
    fullStream,
    object: Promise.resolve(result),
  };
}

const mockCodebaseBackend = {
  ask: vi.fn().mockResolvedValue(''),
};

describe('runSkillDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockCodebaseBackend.ask).mockResolvedValue('');
  });

  it('resolves with skillExists true and existingSkillPath when similar skill exists', async () => {
    const result: SkillDiscoveryResult = {
      skillExists: true,
      existingSkillPath: '.cursor/skills/act/dev-changelog/SKILL.md',
      reasoning: 'The work matches the existing dev-changelog skill.',
    };

    vi.mocked(Agent).mockImplementation(
      () =>
        ({
          stream: vi.fn().mockResolvedValue(makeFakeOutput([], result)),
        }) as unknown as InstanceType<typeof Agent>,
    );

    const out = await runSkillDiscovery({
      goal: 'Update changelog',
      worktreePath: '/tmp/worktree',
      workerMemory: { allReviewerIssues: [], allResolutions: [] },
      reviewerMemory: { feedbackLog: [] },
      codebaseBackend: mockCodebaseBackend as never,
    });

    expect(out).toEqual(result);
    expect(out.skillExists).toBe(true);
    expect(out.existingSkillPath).toBe('.cursor/skills/act/dev-changelog/SKILL.md');
    expect(out.suggestedIssue).toBeUndefined();
  });

  it('resolves with skillExists false and suggestedIssue when no similar skill exists', async () => {
    const result: SkillDiscoveryResult = {
      skillExists: false,
      reasoning: 'No existing skill covers this pattern.',
      suggestedIssue: {
        title: 'Skill candidate: Add foo-bar workflow',
        body: '## Files changed\n- src/foo.ts\n\n## Reviewer feedback\n...',
      },
    };

    vi.mocked(Agent).mockImplementation(
      () =>
        ({
          stream: vi.fn().mockResolvedValue(makeFakeOutput([], result)),
        }) as unknown as InstanceType<typeof Agent>,
    );

    const out = await runSkillDiscovery({
      goal: 'Implement foo-bar',
      worktreePath: '/tmp/worktree',
      workerMemory: { allReviewerIssues: [], allResolutions: [] },
      reviewerMemory: { feedbackLog: [] },
      codebaseBackend: mockCodebaseBackend as never,
    });

    expect(out.skillExists).toBe(false);
    expect(out.suggestedIssue).toBeDefined();
    expect(out.suggestedIssue!.title).toBe('Skill candidate: Add foo-bar workflow');
    expect(out.suggestedIssue!.body).toContain('## Files changed');
  });

  it('calls onThought with each text delta in order', async () => {
    const deltas = ['Scanning ', 'skills...'];
    const result: SkillDiscoveryResult = {
      skillExists: true,
      existingSkillPath: '.cursor/skills/act/dev/SKILL.md',
      reasoning: 'Found match.',
    };

    vi.mocked(Agent).mockImplementation(
      () =>
        ({
          stream: vi.fn().mockResolvedValue(makeFakeOutput(deltas, result)),
        }) as unknown as InstanceType<typeof Agent>,
    );

    const received: string[] = [];
    await runSkillDiscovery({
      goal: 'Test',
      worktreePath: '/tmp/worktree',
      workerMemory: { allReviewerIssues: [], allResolutions: [] },
      reviewerMemory: { feedbackLog: [] },
      codebaseBackend: mockCodebaseBackend as never,
      onThought: (d) => received.push(d),
    });

    expect(received).toEqual(deltas);
  });

  it('resolves with existingIssueMatch when relevant skill-candidate issue exists', async () => {
    const result: SkillDiscoveryResult = {
      skillExists: false,
      existingIssueMatch: {
        number: 123,
        url: 'https://github.com/owner/repo/issues/123',
      },
      reasoning: 'Issue #123 already describes this foo-bar pattern.',
    };

    vi.mocked(Agent).mockImplementation(
      () =>
        ({
          stream: vi.fn().mockResolvedValue(makeFakeOutput([], result)),
        }) as unknown as InstanceType<typeof Agent>,
    );

    const out = await runSkillDiscovery({
      goal: 'Implement foo-bar',
      worktreePath: '/tmp/worktree',
      workerMemory: { allReviewerIssues: [], allResolutions: [] },
      reviewerMemory: { feedbackLog: [] },
      existingSkillCandidateIssues: [
        {
          number: 123,
          title: 'Skill candidate: foo-bar workflow',
          body: '...',
          url: 'https://github.com/owner/repo/issues/123',
        },
      ],
      codebaseBackend: mockCodebaseBackend as never,
    });

    expect(out.existingIssueMatch).toEqual({
      number: 123,
      url: 'https://github.com/owner/repo/issues/123',
    });
    expect(out.suggestedIssue).toBeUndefined();
  });

  it('does not call onThought when not provided', async () => {
    const result: SkillDiscoveryResult = {
      skillExists: false,
      reasoning: 'No match.',
      suggestedIssue: { title: 'T', body: 'B' },
    };

    vi.mocked(Agent).mockImplementation(
      () =>
        ({
          stream: vi.fn().mockResolvedValue(makeFakeOutput(['delta'], result)),
        }) as unknown as InstanceType<typeof Agent>,
    );

    await expect(
      runSkillDiscovery({
        goal: 'Test',
        worktreePath: '/tmp/worktree',
        workerMemory: { allReviewerIssues: [], allResolutions: [] },
        reviewerMemory: { feedbackLog: [] },
        codebaseBackend: mockCodebaseBackend as never,
      }),
    ).resolves.toEqual(result);
  });
});

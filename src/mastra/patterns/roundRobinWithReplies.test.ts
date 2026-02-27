/**
 * Tests for the Round Robin With Replies (Mention-Driven) pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createRoundRobinWithRepliesWorkflow, extractMentions } from './roundRobinWithReplies.js';

const InputSchema = z.object({ proposal: z.string() });
const OutputSchema = z.object({ verdict: z.string() });

vi.mock('@mastra/core/agent', () => ({
  Agent: vi.fn().mockImplementation((opts?: { id?: string }) => {
    const id = (opts as { id?: string })?.id ?? 'agent';
    return {
      generate: vi
        .fn()
        .mockImplementation(
          (_messages: unknown[], options?: { structuredOutput?: { schema: z.ZodType } }) => {
            if (options?.structuredOutput) {
              return Promise.resolve({
                text: '',
                object: { verdict: 'Proceed with modifications' },
              });
            }
            return Promise.resolve({
              text: `Review from ${id}`,
              object: undefined,
            });
          },
        ),
    };
  }),
}));

describe('extractMentions', () => {
  it('extracts @mentions by agent id', () => {
    expect(extractMentions('Please @architect clarify the design', ['architect', 'pm'])).toEqual([
      'architect',
    ]);
    expect(extractMentions('@architect and @pm need to discuss', ['architect', 'pm'])).toEqual(
      expect.arrayContaining(['architect', 'pm']),
    );
  });

  it('avoids partial matches', () => {
    expect(extractMentions('@architect', ['arch'])).toEqual([]);
    expect(extractMentions('@arch', ['arch'])).toEqual(['arch']);
    expect(extractMentions('@architect', ['architect'])).toEqual(['architect']);
  });
});

describe('createRoundRobinWithRepliesWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when agents is empty', () => {
    const synth = new Agent({ id: 'synth' });
    expect(() =>
      createRoundRobinWithRepliesWorkflow({
        workflowId: 'test',
        inputSchema: InputSchema,
        artifactKey: 'proposal',
        agents: [],
        synthesizer: synth,
        outputSchema: OutputSchema,
        synthesizerPromptTemplate: '{artifact} {thread}',
      }),
    ).toThrow('RoundRobinWithReplies requires at least one agent');
  });

  it('runs full round and synthesizes when no mentions', async () => {
    const archAgent = new Agent({ id: 'architect' });
    const synthAgent = new Agent({ id: 'synthesizer' });

    const workflow = createRoundRobinWithRepliesWorkflow({
      workflowId: 'design-review',
      inputSchema: InputSchema,
      artifactKey: 'proposal',
      agents: [
        {
          id: 'architect',
          description: 'Technical design',
          agent: archAgent,
          promptTemplate: 'Review: {artifact}\n\nDiscussion: {thread}',
        },
      ],
      maxRounds: 2,
      synthesizer: synthAgent,
      outputSchema: OutputSchema,
      synthesizerPromptTemplate: 'Proposal:\n{artifact}\n\nDiscussion:\n{thread}',
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { proposal: 'Design proposal' } });

    expect(result.status).toBe('success');
    const output = (result as { result?: { verdict?: string } }).result;
    expect(output?.verdict).toBeDefined();
  });
});

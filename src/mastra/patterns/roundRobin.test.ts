/**
 * Tests for the Round Robin pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createRoundRobinWorkflow } from './roundRobin.js';

const InputSchema = z.object({ document: z.string() });
const OutputSchema = z.object({ consensus: z.string() });

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
                object: { consensus: 'Agreed on approach' },
              });
            }
            return Promise.resolve({
              text: `Response from ${id}`,
              object: undefined,
            });
          },
        ),
    };
  }),
}));

describe('createRoundRobinWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when agents is empty', () => {
    expect(() =>
      createRoundRobinWorkflow({
        workflowId: 'test',
        inputSchema: InputSchema,
        artifactKey: 'document',
        agents: [],
        outputSchema: OutputSchema,
      }),
    ).toThrow('RoundRobin requires at least one agent');
  });

  it('throws when synthesizer provided without synthesizerPromptTemplate', () => {
    const agent = new Agent({ id: 'arch' });
    expect(() =>
      createRoundRobinWorkflow({
        workflowId: 'test',
        inputSchema: InputSchema,
        artifactKey: 'document',
        agents: [{ id: 'arch', description: 'Architect', agent, promptTemplate: '{artifact}' }],
        synthesizer: new Agent({ id: 'synth' }),
        outputSchema: OutputSchema,
      }),
    ).toThrow('synthesizerPromptTemplate is required');
  });

  it('runs agents in sequence and synthesizes', async () => {
    const archAgent = new Agent({ id: 'architect' });
    const pmAgent = new Agent({ id: 'pm' });
    const synthAgent = new Agent({ id: 'synthesizer' });

    const workflow = createRoundRobinWorkflow({
      workflowId: 'round-robin',
      inputSchema: InputSchema,
      artifactKey: 'document',
      agents: [
        {
          id: 'architect',
          description: 'Technical design',
          agent: archAgent,
          promptTemplate: 'Artifact: {artifact} Thread: {thread}',
        },
        {
          id: 'pm',
          description: 'Scope and timeline',
          agent: pmAgent,
          promptTemplate: 'Artifact: {artifact} Thread: {thread}',
        },
      ],
      rounds: 1,
      synthesizer: synthAgent,
      outputSchema: OutputSchema,
      synthesizerPromptTemplate: 'Artifact:\n{artifact}\n\nThread:\n{thread}\n\nSynthesize.',
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { document: 'Proposal text' } });

    expect(result.status).toBe('success');
    const output = (result as { result?: { consensus?: string } }).result;
    expect(output?.consensus).toBe('Agreed on approach');
    expect(archAgent.generate).toHaveBeenCalled();
    expect(pmAgent.generate).toHaveBeenCalled();
    expect(synthAgent.generate).toHaveBeenCalled();
  });

  it('returns thread when synthesizer is omitted', async () => {
    const archAgent = new Agent({ id: 'arch' });

    const workflow = createRoundRobinWorkflow({
      workflowId: 'round-robin-passthrough',
      inputSchema: InputSchema,
      artifactKey: 'document',
      agents: [
        {
          id: 'arch',
          description: 'Architect',
          agent: archAgent,
          promptTemplate: 'Review: {artifact}',
        },
      ],
      rounds: 1,
      outputSchema: z.object({ thread: z.string() }),
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { document: 'Doc' } });

    expect(result.status).toBe('success');
    const output = (result as { result?: { thread?: string } }).result;
    expect(output?.thread).toContain('Response from arch');
  });
});

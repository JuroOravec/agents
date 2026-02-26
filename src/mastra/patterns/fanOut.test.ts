/**
 * Tests for the Fan-Out (Parallel Panel) pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createFanOutWorkflow } from './fanOut.js';

const InputSchema = z.object({ document: z.string() });
const OutputSchema = z.object({ summary: z.string(), recommendations: z.array(z.string()) });

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
                object: { summary: `Synth from ${id}`, recommendations: ['rec1'] },
              });
            }
            return Promise.resolve({
              text: `Critique from ${id}`,
              object: undefined,
            });
          },
        ),
    };
  }),
}));

describe('createFanOutWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when reviewers is empty', () => {
    const synth = new Agent({ id: 'synth' });
    expect(() =>
      createFanOutWorkflow({
        workflowId: 'test',
        inputSchema: InputSchema,
        artifactKey: 'document',
        reviewers: [],
        synthesizer: synth,
        outputSchema: OutputSchema,
        synthesizerPromptTemplate: 'Artifact: {artifact} Critiques: {critiques}',
      }),
    ).toThrow('FanOut requires at least one reviewer');
  });

  it('runs reviewers in parallel and synthesizes output', async () => {
    const archAgent = new Agent({ id: 'architect' });
    const secAgent = new Agent({ id: 'security' });
    const synthAgent = new Agent({ id: 'synthesizer' });

    const workflow = createFanOutWorkflow({
      workflowId: 'prd-review',
      inputSchema: InputSchema,
      artifactKey: 'document',
      reviewers: [
        { id: 'architect', agent: archAgent, promptTemplate: 'Review: {artifact}' },
        { id: 'security', agent: secAgent, promptTemplate: 'Review security: {artifact}' },
      ],
      synthesizer: synthAgent,
      outputSchema: OutputSchema,
      synthesizerPromptTemplate: 'Artifact:\n{artifact}\n\nCritiques:\n{critiques}\n\nSynthesize.',
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { document: 'PRD content here' } });

    expect(result.status).toBe('success');
    const output = (result as { result?: { summary?: string } }).result;
    expect(output?.summary).toBeDefined();
    expect(archAgent.generate).toHaveBeenCalled();
    expect(secAgent.generate).toHaveBeenCalled();
    expect(synthAgent.generate).toHaveBeenCalled();
  });
});

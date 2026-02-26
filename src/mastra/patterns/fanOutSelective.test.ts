/**
 * Tests for the Fan-Out Selective pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createFanOutSelectiveWorkflow } from './fanOutSelective.js';

const InputSchema = z.object({
  document: z.string(),
  expertIds: z.array(z.string()).optional(),
});
const OutputSchema = z.object({ summary: z.string() });

vi.mock('@mastra/core/agent', () => ({
  Agent: vi.fn().mockImplementation((opts?: { id?: string }) => {
    const id = (opts as { id?: string })?.id ?? 'agent';
    return {
      generate: vi
        .fn()
        .mockImplementation(
          (_messages: unknown[], options?: { structuredOutput?: { schema: z.ZodType } }) => {
            if (options?.structuredOutput) {
              return Promise.resolve({ text: '', object: { summary: `Synth from ${id}` } });
            }
            return Promise.resolve({ text: `Critique from ${id}`, object: undefined });
          },
        ),
    };
  }),
}));

describe('createFanOutSelectiveWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when experts is empty', () => {
    const synth = new Agent({ id: 'synth' });
    expect(() =>
      createFanOutSelectiveWorkflow({
        workflowId: 'test',
        inputSchema: InputSchema,
        artifactKey: 'document',
        experts: [],
        synthesizer: synth,
        outputSchema: OutputSchema,
        synthesizerPromptTemplate: 'Artifact: {artifact} Critiques: {critiques}',
      }),
    ).toThrow('FanOutSelective requires at least one expert');
  });

  it('runs all experts when expertsKey is not provided', async () => {
    const secAgent = new Agent({ id: 'sec' });
    const uxAgent = new Agent({ id: 'ux' });
    const synth = new Agent({ id: 'synth' });

    const workflow = createFanOutSelectiveWorkflow({
      workflowId: 'selective-review',
      inputSchema: InputSchema,
      artifactKey: 'document',
      experts: [
        { id: 'sec', agent: secAgent, promptTemplate: 'Security: {artifact}' },
        { id: 'ux', agent: uxAgent, promptTemplate: 'UX: {artifact}' },
      ],
      synthesizer: synth,
      outputSchema: OutputSchema,
      synthesizerPromptTemplate: 'Artifact:\n{artifact}\n\nCritiques:\n{critiques}',
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { document: 'Doc content' } });

    expect(result.status).toBe('success');
    expect(secAgent.generate).toHaveBeenCalled();
    expect(uxAgent.generate).toHaveBeenCalled();
  });

  it('filters critiques with filterAndRank', async () => {
    const secAgent = new Agent({ id: 'sec' });
    const synth = new Agent({ id: 'synth' });

    const workflow = createFanOutSelectiveWorkflow({
      workflowId: 'selective',
      inputSchema: InputSchema,
      artifactKey: 'document',
      experts: [{ id: 'sec', agent: secAgent, promptTemplate: '{artifact}' }],
      synthesizer: synth,
      outputSchema: OutputSchema,
      synthesizerPromptTemplate: '{critiques}',
      filterAndRank: (outputs) => outputs.slice(0, 1),
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { document: 'x' } });

    expect(result.status).toBe('success');
  });
});

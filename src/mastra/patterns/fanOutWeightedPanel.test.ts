/**
 * Tests for the Fan-Out Weighted Panel pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createFanOutWeightedPanelWorkflow } from './fanOutWeightedPanel.js';

const InputSchema = z.object({ document: z.string() });
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
              return Promise.resolve({ text: '', object: { summary: `From ${id}` } });
            }
            return Promise.resolve({ text: `Critique from ${id}`, object: undefined });
          },
        ),
    };
  }),
}));

describe('createFanOutWeightedPanelWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when reviewers is empty', () => {
    const synth = new Agent({ id: 'synth' });
    expect(() =>
      createFanOutWeightedPanelWorkflow({
        workflowId: 'test',
        inputSchema: InputSchema,
        artifactKey: 'document',
        reviewers: [],
        synthesizer: synth,
        outputSchema: OutputSchema,
        synthesizerPromptTemplate: 'Artifact: {artifact} Critiques: {critiques} Weights: {weights}',
      }),
    ).toThrow('FanOutWeightedPanel requires at least one reviewer');
  });

  it('passes weights to synthesizer', async () => {
    const secAgent = new Agent({ id: 'security' });
    const pmAgent = new Agent({ id: 'pm' });
    const synth = new Agent({ id: 'synth' });

    const workflow = createFanOutWeightedPanelWorkflow({
      workflowId: 'weighted-prd-review',
      inputSchema: InputSchema,
      artifactKey: 'document',
      reviewers: [
        { id: 'security', agent: secAgent, promptTemplate: 'Review: {artifact}', weight: 2 },
        { id: 'pm', agent: pmAgent, promptTemplate: 'Review: {artifact}', weight: 1 },
      ],
      synthesizer: synth,
      outputSchema: OutputSchema,
      synthesizerPromptTemplate:
        'Artifact:\n{artifact}\n\nCritiques:\n{critiques}\n\nWeights: {weights}',
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { document: 'PRD' } });

    expect(result.status).toBe('success');
    expect(synth.generate).toHaveBeenCalled();
    const promptContent =
      (synth.generate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.[0]?.content ?? '';
    expect(promptContent).toContain('security: weight 2');
    expect(promptContent).toContain('pm: weight 1');
  });
});

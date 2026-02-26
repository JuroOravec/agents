/**
 * Tests for the Reflection / Self-Correction pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createSelfCorrectionWorkflow } from './selfCorrection.js';

const InputSchema = z.object({ prompt: z.string() });
const OutputSchema = z.object({ final: z.string() });

vi.mock('@mastra/core/agent', () => ({
  Agent: vi.fn().mockImplementation((opts?: { id?: string }) => {
    const agentId = (opts as { id?: string })?.id ?? 'agent';
    return {
      generate: vi
        .fn()
        .mockImplementation(
          (
            messages: { role: string; content: string }[],
            options?: { structuredOutput?: { schema: z.ZodType } },
          ) => {
            const content = messages[0]?.content ?? '';
            if (options?.structuredOutput) {
              return Promise.resolve({
                text: '',
                object: { final: 'final-revised-output' },
              });
            }
            if (content.startsWith('Critique')) {
              return Promise.resolve({
                text: 'This is a critique',
                object: undefined,
              });
            }
            return Promise.resolve({
              text: `Draft from ${agentId}`,
              object: undefined,
            });
          },
        ),
    };
  }),
}));

describe('createSelfCorrectionWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs generate, critique, and revise steps sequentially', async () => {
    const agent = new Agent({ id: 'writer' });

    const workflow = createSelfCorrectionWorkflow({
      workflowId: 'test-self-correction',
      inputSchema: InputSchema,
      inputKey: 'prompt',
      agent,
      generatePromptTemplate: 'Write: {input}',
      critiquePromptTemplate: 'Critique. Input: {input}, Draft: {draft}',
      revisePromptTemplate: 'Revise. Input: {input}, Draft: {draft}, Critique: {critique}',
      outputSchema: OutputSchema,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { prompt: 'write a poem' } });

    expect(result.status).toBe('success');
    const output = (result as { result?: { final?: string } }).result;
    expect(output?.final).toBe('final-revised-output');

    // Agent should be called 3 times (generate, critique, revise)
    expect(agent.generate).toHaveBeenCalledTimes(3);
  });
});

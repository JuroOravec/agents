/**
 * Tests for the Adversarial Fan-Out pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  ADVOCATE_ROLE,
  ADVERSARY_ROLE,
  createFanOutAdversarialWorkflow,
} from './fanOutAdversarial.js';

const InputSchema = z.object({ proposal: z.string() });
const OutputSchema = z.object({ verdict: z.string(), risks: z.array(z.string()) });

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
                object: { verdict: 'Proceed with caution', risks: ['risk1'] },
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

describe('createFanOutAdversarialWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when advocate and adversary have same id', () => {
    const advAgent = new Agent({ id: 'adv' });
    const synth = new Agent({ id: 'synth' });
    expect(() =>
      createFanOutAdversarialWorkflow({
        workflowId: 'test',
        inputSchema: InputSchema,
        artifactKey: 'proposal',
        advocate: { id: 'same', agent: advAgent, role: ADVOCATE_ROLE },
        adversary: { id: 'same', agent: advAgent, role: ADVERSARY_ROLE },
        synthesizer: synth,
        outputSchema: OutputSchema,
        synthesizerPromptTemplate: 'Proposal: {artifact} Critiques: {critiques}',
      }),
    ).toThrow('advocate and adversary must have distinct ids');
  });

  it('runs advocate and adversary in parallel and synthesizes', async () => {
    const advocate = new Agent({ id: 'advocate' });
    const adversary = new Agent({ id: 'adversary' });
    const synth = new Agent({ id: 'synthesizer' });

    const workflow = createFanOutAdversarialWorkflow({
      workflowId: 'adversarial-review',
      inputSchema: InputSchema,
      artifactKey: 'proposal',
      advocate: { id: 'advocate', agent: advocate, role: ADVOCATE_ROLE },
      adversary: { id: 'adversary', agent: adversary, role: ADVERSARY_ROLE },
      synthesizer: synth,
      outputSchema: OutputSchema,
      synthesizerPromptTemplate: 'Proposal:\n{artifact}\n\nCritiques:\n{critiques}\n\nSynthesize.',
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { proposal: 'New feature X' } });

    expect(result.status).toBe('success');
    const output = (result as { result?: { verdict?: string } }).result;
    expect(output?.verdict).toBeDefined();
    expect(advocate.generate).toHaveBeenCalled();
    expect(adversary.generate).toHaveBeenCalled();
    expect(synth.generate).toHaveBeenCalled();
  });
});

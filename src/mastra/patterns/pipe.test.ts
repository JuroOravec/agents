/**
 * Tests for the Pipe (Sequential Conference) pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createPipeWorkflow } from './pipe.js';

const InputSchema = z.object({ spec: z.string() });
const OutputSchema = z.object({ design: z.string() });

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
            const hasStructuredOutput = !!options?.structuredOutput;
            if (hasStructuredOutput) {
              return Promise.resolve({
                text: `Synthesized from ${agentId}`,
                object: { design: `synthesized-design-from-${agentId}` },
              });
            }
            const content = messages[0]?.content ?? '';
            const priorMatch = content.includes('(First agent') ? 'first' : 'has-prior';
            return Promise.resolve({
              text: `${agentId}-output-${priorMatch}`,
              object: undefined,
            });
          },
        ),
    };
  }),
}));

describe('createPipeWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when agents is empty', () => {
    const synthesizer = new Agent({ id: 'synth' });
    expect(() =>
      createPipeWorkflow({
        workflowId: 'test',
        inputSchema: InputSchema,
        artifactKey: 'spec',
        agents: [],
        synthesizer,
        outputSchema: OutputSchema,
      }),
    ).toThrow('Pipe requires at least one agent');
  });

  it('passes artifact through the pipe and synthesizer produces output', async () => {
    const archAgent = new Agent({ id: 'arch' });
    const implAgent = new Agent({ id: 'impl' });
    const synthAgent = new Agent({ id: 'synthesizer' });

    const workflow = createPipeWorkflow({
      workflowId: 'pipe-review',
      inputSchema: InputSchema,
      artifactKey: 'spec',
      agents: [
        {
          id: 'arch',
          agent: archAgent,
          promptTemplate: 'Artifact: {artifact}\nPrior: {priorOutput}',
        },
        {
          id: 'impl',
          agent: implAgent,
          promptTemplate: 'Artifact: {artifact}\nPrior: {priorOutput}',
        },
      ],
      synthesizer: synthAgent,
      outputSchema: OutputSchema,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { spec: 'Build a login form' } });

    expect(result.status).toBe('success');
    const output = (result as { result?: { design?: string } }).result;
    expect(output?.design).toBeDefined();
    expect(archAgent.generate).toHaveBeenCalled();
    expect(implAgent.generate).toHaveBeenCalled();
    expect(synthAgent.generate).toHaveBeenCalled();
  });
});

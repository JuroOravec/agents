/**
 * Tests for the Router pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createRouterWorkflow } from './router.js';

const InputSchema = z.object({ query: z.string() });
const OutputSchema = z.object({ answer: z.string() });

vi.mock('@mastra/core/agent', () => ({
  Agent: vi.fn().mockImplementation((opts?: { id?: string }) => {
    const agentId = (opts as { id?: string })?.id ?? 'agent';
    return {
      generate: vi
        .fn()
        .mockImplementation(
          (_messages: unknown[], options?: { structuredOutput?: { schema: z.ZodType } }) => {
            const schema = options?.structuredOutput?.schema as
              | z.ZodObject<Record<string, z.ZodType>>
              | undefined;
            const shape = schema?.shape;
            if (shape && 'selectedId' in (shape ?? {})) {
              return Promise.resolve({
                text: '',
                object: { selectedId: 'tech' },
              });
            }
            return Promise.resolve({
              text: 'Mocked response',
              object: { answer: `answer-from-${agentId}` },
            });
          },
        ),
    };
  }),
}));

describe('createRouterWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when branches is empty', () => {
    const router = new Agent({ id: 'router' });
    expect(() =>
      createRouterWorkflow({
        workflowId: 'test',
        inputSchema: InputSchema,
        inputKey: 'query',
        router,
        branches: [],
        outputSchema: OutputSchema,
      }),
    ).toThrow('Router requires at least one branch');
  });

  it('routes to the selected branch and returns specialist output', async () => {
    const router = new Agent({ id: 'router' });
    const techAgent = new Agent({ id: 'tech' });
    const generalAgent = new Agent({ id: 'general' });

    const workflow = createRouterWorkflow({
      workflowId: 'test-router',
      inputSchema: InputSchema,
      inputKey: 'query',
      router,
      branches: [
        { id: 'tech', agent: techAgent, promptTemplate: 'Answer: {input}' },
        { id: 'general', agent: generalAgent, promptTemplate: 'Answer: {input}' },
      ],
      outputSchema: OutputSchema,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { query: 'How do I fix my code?' } });

    expect(result.status).toBe('success');
    const output = (result as { result?: Record<string, { answer?: string }> }).result;
    expect(output).toBeDefined();
    expect(output!.tech?.answer ?? output!.answer).toBe('answer-from-tech');
  });
});

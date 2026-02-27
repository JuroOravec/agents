/**
 * Tests for the Evaluator-Optimizer (Actor-Critic) pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createEvaluatorOptimizerWorkflow } from './evaluatorOptimizer.js';

const InputSchema = z.object({ task_description: z.string() });
const OutputSchema = z.object({ result: z.string(), iterations: z.number() });

vi.mock('@mastra/core/agent', () => ({
  Agent: vi.fn().mockImplementation((opts?: { id?: string }) => {
    const id = (opts as { id?: string })?.id ?? 'agent';
    return {
      generate: vi
        .fn()
        .mockImplementation(
          (_messages: unknown[], options?: { structuredOutput?: { schema: z.ZodType } }) => {
            const schema = options?.structuredOutput?.schema as
              | z.ZodObject<Record<string, z.ZodType>>
              | undefined;
            const shape = schema?.shape ?? {};
            if ('draft' in shape) {
              return Promise.resolve({
                text: '',
                object: { draft: 'improved draft' },
              });
            }
            if ('approved' in shape) {
              return Promise.resolve({
                text: '',
                object: { approved: id === 'eval' ? true : false, feedback: 'Looks good' },
              });
            }
            return Promise.resolve({ text: '', object: {} });
          },
        ),
    };
  }),
}));

describe('createEvaluatorOptimizerWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exits on first iteration when evaluator approves', async () => {
    const generator = new Agent({ id: 'gen' });
    const evaluator = new Agent({ id: 'eval' });

    const workflow = createEvaluatorOptimizerWorkflow({
      workflowId: 'actor-critic',
      inputSchema: InputSchema,
      taskKey: 'task_description',
      generator,
      evaluator,
      generatorPromptTemplate: 'Task: {task}',
      evaluatorPromptTemplate: 'Evaluate: {task} {draft}',
      outputSchema: OutputSchema,
      maxRetries: 3,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { task_description: 'Write a report' } });

    expect(result.status).toBe('success');
    const output = (result as { result?: { result?: string; iterations?: number } }).result;
    expect(output?.result).toBe('improved draft');
    expect(output?.iterations).toBe(1);
  });

  it('retries until approved when evaluator initially rejects', async () => {
    let evalCallCount = 0;

    vi.mocked(Agent).mockImplementation((_opts?: { id?: string }) => {
      const generate = vi
        .fn()
        .mockImplementation(
          (_messages: unknown[], options?: { structuredOutput?: { schema: z.ZodType } }) => {
            const schema = options?.structuredOutput?.schema as
              | z.ZodObject<Record<string, z.ZodType>>
              | undefined;
            const shape = schema?.shape ?? {};
            if ('draft' in shape) {
              return Promise.resolve({
                text: '',
                object: { draft: `draft-v${evalCallCount + 1}` },
              });
            }
            if ('approved' in shape) {
              evalCallCount++;
              const approved = evalCallCount >= 2;
              return Promise.resolve({
                text: '',
                object: { approved, feedback: approved ? 'OK' : 'Needs work' },
              });
            }
            return Promise.resolve({ text: '', object: {} });
          },
        );
      return { generate };
    });

    const workflow = createEvaluatorOptimizerWorkflow({
      workflowId: 'actor-critic',
      inputSchema: InputSchema,
      taskKey: 'task_description',
      generator: new Agent({ id: 'gen' }),
      evaluator: new Agent({ id: 'eval' }),
      generatorPromptTemplate: 'Task: {task}',
      evaluatorPromptTemplate: 'Evaluate: {draft}',
      outputSchema: OutputSchema,
      maxRetries: 5,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { task_description: 'task' } });

    expect(result.status).toBe('success');
    expect(evalCallCount).toBe(2);
  });
});

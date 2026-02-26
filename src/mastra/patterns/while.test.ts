/**
 * Tests for the While pattern.
 */

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createWhileWorkflow } from './while.js';

const InputSchema = z.object({ request: z.string() });
const OutputSchema = z.object({ result: z.string() });

function createSimpleSubWorkflow() {
  return createWorkflow({
    id: 'sub',
    inputSchema: z.any(),
    outputSchema: z.object({ text: z.string() }),
  })
    .then(
      createStep({
        id: 'echo',
        inputSchema: z.any(),
        outputSchema: z.object({ text: z.string() }),
        execute: async ({ inputData }) => ({
          text: String((inputData as { request?: string }).request ?? 'unknown'),
        }),
      }),
    )
    .commit();
}

describe('createWhileWorkflow', () => {
  it('runs zero iterations when condition is false from the start', async () => {
    const subWorkflow = createSimpleSubWorkflow();
    const synthesizerStep = createStep({
      id: 'synthesize',
      inputSchema: z.object({ inputData: z.any(), outputs: z.array(z.any()) }),
      outputSchema: OutputSchema,
      execute: async ({ inputData }) => {
        const { outputs } = inputData as { inputData: unknown; outputs: unknown[] };
        return { result: outputs.length === 0 ? 'skipped' : 'ran' };
      },
    });

    const workflow = createWhileWorkflow({
      workflowId: 'while-test',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      subWorkflow,
      condition: () => false,
      maxIterations: 5,
      synthesizerStep,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { request: 'hello' } });

    expect(result.status).toBe('success');
    expect((result as { result?: { result?: string } }).result?.result).toBe('skipped');
  });

  it('runs while condition is true and collects outputs', async () => {
    const subWorkflow = createSimpleSubWorkflow();
    const synthesizerStep = createStep({
      id: 'synthesize',
      inputSchema: z.object({ inputData: z.any(), outputs: z.array(z.any()) }),
      outputSchema: OutputSchema,
      execute: async ({ inputData }) => {
        const { outputs } = inputData as { outputs: { text: string }[] };
        return { result: outputs.length ? outputs[outputs.length - 1]!.text : '(empty)' };
      },
    });

    const workflow = createWhileWorkflow({
      workflowId: 'while-test',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      subWorkflow,
      condition: (index) => index < 2,
      maxIterations: 5,
      synthesizerStep,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { request: 'hello' } });

    expect(result.status).toBe('success');
    expect((result as { result?: { result?: string } }).result?.result).toBe('hello');
  });
});

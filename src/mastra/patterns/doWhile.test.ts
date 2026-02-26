/**
 * Tests for the DoWhile pattern.
 */

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createDoWhileWorkflow } from './doWhile.js';

const InputSchema = z.object({ task: z.string() });
const OutputSchema = z.object({ best: z.string() });

function createSimpleSubWorkflow() {
  return createWorkflow({
    id: 'sub',
    inputSchema: z.any(),
    outputSchema: z.object({ draft: z.string(), confidence: z.number() }),
  })
    .then(
      createStep({
        id: 'draft',
        inputSchema: z.any(),
        outputSchema: z.object({ draft: z.string(), confidence: z.number() }),
        execute: async ({ inputData }) => {
          const task = String((inputData as { task?: string }).task ?? 'unknown');
          return { draft: `draft-${task}`, confidence: 0.5 };
        },
      }),
    )
    .commit();
}

describe('createDoWhileWorkflow', () => {
  it('runs at least once and stops when condition is false', async () => {
    const subWorkflow = createSimpleSubWorkflow();
    const synthesizerStep = createStep({
      id: 'synthesize',
      inputSchema: z.object({ inputData: z.any(), outputs: z.array(z.any()) }),
      outputSchema: OutputSchema,
      execute: async ({ inputData }) => {
        const { outputs } = inputData as { inputData: unknown; outputs: { draft: string }[] };
        return { best: outputs[outputs.length - 1]!.draft };
      },
    });

    const workflow = createDoWhileWorkflow({
      workflowId: 'do-while-test',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      subWorkflow,
      condition: () => false,
      maxIterations: 5,
      synthesizerStep,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { task: 'write report' } });

    expect(result.status).toBe('success');
    expect((result as { result?: { best?: string } }).result?.best).toBe('draft-write report');
  });

  it('runs multiple iterations while condition is true', async () => {
    let callCount = 0;
    const subWorkflow = createWorkflow({
      id: 'sub',
      inputSchema: z.any(),
      outputSchema: z.object({ draft: z.string(), confidence: z.number() }),
    })
      .then(
        createStep({
          id: 'draft',
          inputSchema: z.any(),
          outputSchema: z.object({ draft: z.string(), confidence: z.number() }),
          execute: async () => {
            callCount++;
            return { draft: `iteration-${callCount}`, confidence: callCount >= 2 ? 0.95 : 0.5 };
          },
        }),
      )
      .commit();

    const synthesizerStep = createStep({
      id: 'synthesize',
      inputSchema: z.object({ inputData: z.any(), outputs: z.array(z.any()) }),
      outputSchema: OutputSchema,
      execute: async ({ inputData }) => {
        const { outputs } = inputData as { inputData: unknown; outputs: { draft: string }[] };
        return { best: outputs[outputs.length - 1]!.draft };
      },
    });

    const workflow = createDoWhileWorkflow({
      workflowId: 'do-while-test',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      subWorkflow,
      condition: (_index, lastResult) => (lastResult as { confidence: number }).confidence < 0.9,
      maxIterations: 5,
      synthesizerStep,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { task: 'refine' } });

    expect(result.status).toBe('success');
    expect(callCount).toBe(2);
    expect((result as { result?: { best?: string } }).result?.best).toBe('iteration-2');
  });
});

/**
 * Tests for the Retry pattern.
 */

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createRetryWorkflow } from './retry.js';

const InputSchema = z.object({ text: z.string() });
const OutputSchema = z.object({ summary: z.string(), confidence: z.number() });

describe('createRetryWorkflow', () => {
  it('returns immediately when passCriteria is true on first run', async () => {
    const subWorkflow = createWorkflow({
      id: 'sub',
      inputSchema: z.any(),
      outputSchema: OutputSchema,
    })
      .then(
        createStep({
          id: 'summarize',
          inputSchema: z.any(),
          outputSchema: OutputSchema,
          execute: async () => ({
            summary: 'High quality summary',
            confidence: 0.9,
          }),
        }),
      )
      .commit();

    const workflow = createRetryWorkflow({
      workflowId: 'retry-test',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      subWorkflow,
      passCriteria: (output) => (output as { confidence: number }).confidence >= 0.85,
      maxIterations: 3,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { text: 'Long document...' } });

    expect(result.status).toBe('success');
    const output = (result as { result?: { summary?: string; confidence?: number } }).result;
    expect(output?.summary).toBe('High quality summary');
    expect(output?.confidence).toBe(0.9);
  });

  it('retries until passCriteria is met', async () => {
    let runCount = 0;
    const subWorkflow = createWorkflow({
      id: 'sub',
      inputSchema: z.any(),
      outputSchema: OutputSchema,
    })
      .then(
        createStep({
          id: 'summarize',
          inputSchema: z.any(),
          outputSchema: OutputSchema,
          execute: async () => {
            runCount++;
            return {
              summary: `Attempt ${runCount}`,
              confidence: runCount >= 3 ? 0.9 : 0.5,
            };
          },
        }),
      )
      .commit();

    const workflow = createRetryWorkflow({
      workflowId: 'retry-test',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      subWorkflow,
      passCriteria: (output) => (output as { confidence: number }).confidence >= 0.85,
      maxIterations: 5,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { text: 'doc' } });

    expect(result.status).toBe('success');
    expect(runCount).toBe(3);
    const output = (result as { result?: { summary?: string; confidence?: number } }).result;
    expect(output?.summary).toBe('Attempt 3');
    expect(output?.confidence).toBe(0.9);
  });

  it('returns last output when maxIterations reached without passing', async () => {
    const subWorkflow = createWorkflow({
      id: 'sub',
      inputSchema: z.any(),
      outputSchema: OutputSchema,
    })
      .then(
        createStep({
          id: 'summarize',
          inputSchema: z.any(),
          outputSchema: OutputSchema,
          execute: async () => ({
            summary: 'Low confidence summary',
            confidence: 0.5,
          }),
        }),
      )
      .commit();

    const workflow = createRetryWorkflow({
      workflowId: 'retry-test',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      subWorkflow,
      passCriteria: (output) => (output as { confidence: number }).confidence >= 0.9,
      maxIterations: 2,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { text: 'doc' } });

    expect(result.status).toBe('success');
    const output = (result as { result?: { summary?: string; confidence?: number } }).result;
    expect(output?.confidence).toBe(0.5);
  });
});

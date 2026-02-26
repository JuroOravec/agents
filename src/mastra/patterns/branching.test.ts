/**
 * Tests for the Branching (Conditional Routing) pattern.
 */

import { createStep } from '@mastra/core/workflows';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createBranchingWorkflow } from './branching.js';
import { createMockStep } from './__tests__/utils.js';

const InputSchema = z.object({ type: z.string() });
const OutputSchema = z.object({ answer: z.string() });

describe('createBranchingWorkflow', () => {
  it('throws when branches is empty', () => {
    const conditionStep = createStep({
      id: 'cond',
      inputSchema: InputSchema,
      outputSchema: InputSchema,
      execute: async ({ inputData }) => inputData,
    });

    expect(() =>
      createBranchingWorkflow({
        workflowId: 'test',
        inputSchema: InputSchema,
        outputSchema: OutputSchema,
        conditionStep,
        branches: [],
      }),
    ).toThrow('Branching requires at least one branch');
  });

  it('routes to the first matching branch and skips the rest', async () => {
    const { step: techStep, executeSpy: techSpy } = createMockStep({
      id: 'tech',
      output: { answer: 'tech' },
    });
    const { step: fallbackStep, executeSpy: fallbackSpy } = createMockStep({
      id: 'fallback',
      output: { answer: 'fallback' },
    });

    const conditionStep = createStep({
      id: 'cond',
      inputSchema: InputSchema,
      outputSchema: InputSchema,
      execute: async ({ inputData }) => inputData,
    });

    const workflow = createBranchingWorkflow({
      workflowId: 'test-branching',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      conditionStep,
      branches: [
        { condition: async () => true, step: techStep },
        { condition: async () => false, step: fallbackStep },
      ],
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { type: 'technical' } });

    expect(techSpy).toHaveBeenCalledTimes(1);
    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    const output = (result as { result?: Record<string, unknown> }).result;
    expect(output?.tech).toEqual({ answer: 'tech' });
  });

  it('routes to fallback when specific condition does not match', async () => {
    const { step: techStep, executeSpy: techSpy } = createMockStep({
      id: 'tech',
      output: { answer: 'tech' },
    });
    const { step: fallbackStep, executeSpy: fallbackSpy } = createMockStep({
      id: 'fallback',
      output: { answer: 'fallback' },
    });

    const conditionStep = createStep({
      id: 'cond',
      inputSchema: InputSchema,
      outputSchema: InputSchema,
      execute: async ({ inputData }) => inputData,
    });

    // Same order as first test: fallback first, tech second (Mastra evaluates last-to-first)
    const workflow = createBranchingWorkflow({
      workflowId: 'test-branching',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      conditionStep,
      branches: [
        { condition: async () => true, step: fallbackStep },
        {
          condition: async ({ inputData }) => (inputData as { type: string }).type === 'technical',
          step: techStep,
        },
      ],
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { type: 'general' } });

    expect(techSpy).not.toHaveBeenCalled();
    expect(fallbackSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    // Branch output is keyed by step id (see Mastra docs)
    const output = (result as { result?: Record<string, { answer?: string }> }).result;
    expect(output?.fallback?.answer).toBe('fallback');
  });

  it('runs mergeStep when provided', async () => {
    const { step: techStep, executeSpy: techSpy } = createMockStep({
      id: 'tech',
      output: { answer: 'tech' },
    });
    const { step: mergeStep, executeSpy: mergeSpy } = createMockStep({
      id: 'merge',
      output: { answer: 'merged-from-tech' },
    });

    const conditionStep = createStep({
      id: 'cond',
      inputSchema: InputSchema,
      outputSchema: InputSchema,
      execute: async ({ inputData }) => inputData,
    });

    const workflow = createBranchingWorkflow({
      workflowId: 'test-branching',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      conditionStep,
      branches: [
        {
          condition: async ({ inputData }) => (inputData as { type: string }).type === 'technical',
          step: techStep,
        },
      ],
      mergeStep,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { type: 'technical' } });

    expect(techSpy).toHaveBeenCalledTimes(1);
    expect(mergeSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect((result as { result: { answer: string } }).result.answer).toBe('merged-from-tech');
  });
});

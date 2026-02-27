/**
 * Retry pattern.
 *
 * Runs a sub-workflow repeatedly until a caller-supplied `passCriteria` function
 * returns true (i.e. the output passed) or maxIterations is reached. Each run
 * receives the original input. Use for quality gates, confidence thresholds, or
 * any pass/fail check on the sub-workflow's output.
 *
 * ```
 * Outer loop:
 *   ├── SubWorkflow(input) → output
 *   └── passCriteria(output)? → Output : retry
 * ```
 *
 * NOTE: Difference from branching or while:
 * - in retry, we have a loop to retry the sub-workflow N times
 * - in branching, we have a conditional to decide which path to take based on the output of the previous step.
 * - `while` workflows are not bounded by a number of iterations, retry is.
 *   Also `retry` returns the last output that passed the passCriteria,
 *   but `while` returns all outputs.
 *
 * @example
 * const workflow = createRetryWorkflow({
 *   workflowId: "retry-summary",
 *   inputSchema: z.object({ text: z.string() }),
 *   outputSchema: z.object({ summary: z.string(), confidence: z.number() }),
 *   subWorkflow: summaryWorkflow,
 *   passCriteria: (output) => (output as { confidence: number }).confidence >= 0.85,
 *   maxIterations: 3,
 * });
 *
 * See docs/features/ai-crews/patterns.md#9-retry
 */

import { type AnyWorkflow, createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export interface RetryOptions<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  workflowId: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  subWorkflow: AnyWorkflow;
  /**
   * Return true to accept the output and stop, false to retry.
   * Receives the sub-workflow's result after each run.
   * Defaults to always accepting (never retries).
   */
  passCriteria?: (output: z.infer<TOutput>) => boolean | Promise<boolean>;
  maxIterations?: number;
}

export function createRetryWorkflow<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  options: RetryOptions<TInput, TOutput>,
) {
  const {
    workflowId,
    inputSchema,
    outputSchema,
    subWorkflow,
    passCriteria = () => true,
    maxIterations = 3,
  } = options;

  const loopStateSchema = z.object({
    inputData: z.any(),
    lastResult: z.any(),
    passed: z.boolean(),
    iteration: z.number(),
  });

  const initStep = createStep({
    id: 'init',
    inputSchema: z.any(),
    outputSchema: loopStateSchema,
    execute: async ({ inputData }) => ({
      inputData,
      lastResult: null,
      passed: false,
      iteration: 0,
    }),
  });

  const runSubStep = createStep({
    id: 'run-sub',
    inputSchema: loopStateSchema,
    outputSchema: loopStateSchema,
    execute: async ({ inputData }) => {
      const state = inputData as z.infer<typeof loopStateSchema>;
      const run = await subWorkflow.createRun();
      const result = await run.start({ inputData: state.inputData });
      if (result.status !== 'success') {
        throw new Error(`Retry: sub-workflow did not succeed (status: ${result.status})`);
      }
      const out = result.result as z.infer<TOutput>;
      const passed = await passCriteria(out);
      return {
        inputData: state.inputData,
        lastResult: out,
        passed,
        iteration: state.iteration + 1,
      };
    },
  });

  return createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    .then(initStep)
    .dountil(runSubStep, async ({ inputData, iterationCount }) => {
      const d = inputData as z.infer<typeof loopStateSchema>;
      return d.passed || iterationCount >= maxIterations;
    })
    .map(
      async ({ inputData }) =>
        (inputData as z.infer<typeof loopStateSchema>).lastResult as z.infer<typeof outputSchema>,
    )
    .commit();
}

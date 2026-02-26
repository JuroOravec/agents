/**
 * Pipeline with Human-in-the-Loop Gate pattern.
 *
 * A three-step pipeline: beforeStep → gateStep → afterStep. The gateStep calls
 * suspend() to pause the workflow; a human approves or edits, then the run is
 * resumed with resumeData. After resume, afterStep runs with the gate output.
 * Use for approval gates, human review, or editing injected content.
 *
 * ```
 * Input ── beforeStep ── gateStep(suspend) ⏸ Human ⏯ resume ── afterStep ── Output
 * ```
 *
 * @example
 * const gateStep = createStep({
 *   id: "gate",
 *   inputSchema: z.any(),
 *   outputSchema: z.any(),
 *   execute: async (inputData, { suspend }) => {
 *     await suspend({ message: "Please approve before continuing" });
 *     return { approved: true };
 *   },
 * });
 * const workflow = createHumanInTheLoopGateWorkflow({
 *   workflowId: "human-in-the-loop-gate",
 *   inputSchema: z.object({ draft: z.string() }),
 *   outputSchema: z.object({ final: z.string() }),
 *   beforeStep: prepareStep,
 *   gateStep,
 *   afterStep: finalizeStep,
 * });
 *
 * See docs/features/ai-crews/patterns.md#10-pipeline-with-human-in-the-loop-gate
 */

import { type createStep, createWorkflow } from '@mastra/core/workflows';
import type { z } from 'zod';

export interface HumanInTheLoopGateOptions<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
> {
  workflowId: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  beforeStep: ReturnType<typeof createStep>;
  /** Step that calls suspend(). On resume, receives resumeData. */
  gateStep: ReturnType<typeof createStep>;
  afterStep: ReturnType<typeof createStep>;
}

export function createHumanInTheLoopGateWorkflow<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(options: HumanInTheLoopGateOptions<TInput, TOutput>) {
  const { workflowId, inputSchema, outputSchema, beforeStep, gateStep, afterStep } = options;

  return createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    .then(beforeStep)
    .then(gateStep)
    .then(afterStep)
    .commit();
}

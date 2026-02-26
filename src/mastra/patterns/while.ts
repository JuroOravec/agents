/**
 * While pattern.
 *
 * Runs a sub-workflow repeatedly while `condition` returns true. Unlike doWhile,
 * may run zero times if `condition(0, undefined, [])` is false on the first check;
 * the sub-workflow is never invoked and the synthesizer receives an empty outputs
 * array. Collects all outputs and passes them to a synthesizer step (like mapThenReduce).
 *
 * Unlike mapThenReduce, the list is not known in advance; the loop runs while the
 * condition holds.
 *
 * ```
 * Input ── loop: while condition → SubWorkflow(input) → collect ── Synthesizer(outputs) ── Output
 * ```
 *
 * @example
 * const synthesizerStep = createStep({
 *   id: "synthesize",
 *   inputSchema: z.object({ inputData: z.any(), outputs: z.array(z.any()) }),
 *   outputSchema: z.object({ result: z.string() }),
 *   execute: async ({ inputData }) => {
 *     const { outputs } = inputData as { outputs: { text: string }[] };
 *     return { result: outputs.length ? outputs[outputs.length - 1]!.text : "(skipped)" };
 *   },
 * });
 * const maxTurns = 3;
 * const workflow = createWhileWorkflow({
 *   workflowId: "while-butler",
 *   inputSchema: z.object({ request: z.string() }),
 *   outputSchema: z.object({ result: z.string() }),
 *   subWorkflow: butlerWorkflow,
 *   // capture maxTurns via closure instead of threading through inputData
 *   condition: (index) => index < maxTurns,
 *   maxIterations: 10,
 *   synthesizerStep,
 * });
 *
 * See docs/features/ai-crews/patterns.md#while
 */

import type { AnyWorkflow } from '@mastra/core/workflows';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export interface WhileOptions<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  workflowId: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  subWorkflow: AnyWorkflow;
  /**
   * Return true to run the sub-workflow this iteration, false to stop.
   * Mirrors Array.forEach callback order: (index, lastResult, allResults).
   * On the first call, `lastResult` is undefined and `allResults` is empty.
   * `allResults` includes `lastResult` as its last element.
   */
  /* eslint-disable-next-line max-params -- workflow condition callback API mirrors forEach(index, item, array) */
  condition: (
    index: number,
    lastResult: z.infer<TOutput> | undefined,
    allResults: z.infer<TOutput>[],
  ) => boolean | Promise<boolean>;
  maxIterations?: number;
  /** Receives { inputData, outputs } and produces final output. */
  synthesizerStep: ReturnType<typeof createStep>;
}

const LoopStateSchema = z.object({
  inputData: z.any(),
  outputs: z.array(z.any()),
  index: z.number(),
  ranThisTurn: z.boolean(),
});

export function createWhileWorkflow<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  options: WhileOptions<TInput, TOutput>,
) {
  const {
    workflowId,
    inputSchema,
    outputSchema,
    subWorkflow,
    condition,
    maxIterations = 5,
    synthesizerStep,
  } = options;

  const initStep = createStep({
    id: 'init',
    inputSchema: z.any(),
    outputSchema: LoopStateSchema,
    execute: async ({ inputData }) => ({
      inputData,
      outputs: [] as z.infer<TOutput>[],
      index: 0,
      ranThisTurn: true, // sentinel: enter loop body to perform first condition check
    }),
  });

  const runSubStep = createStep({
    id: 'run-sub',
    inputSchema: LoopStateSchema,
    outputSchema: LoopStateSchema,
    execute: async ({ inputData }) => {
      const state = inputData as z.infer<typeof LoopStateSchema>;
      const allResults = state.outputs as z.infer<TOutput>[];
      const lastResult = allResults.at(-1);
      const runThisIteration = await condition(state.index, lastResult, allResults);

      if (!runThisIteration || state.index >= maxIterations) {
        return {
          inputData: state.inputData,
          outputs: allResults,
          index: state.index,
          ranThisTurn: false,
        };
      }

      const run = await subWorkflow.createRun();
      const result = await run.start({ inputData: state.inputData });
      if (result.status !== 'success') {
        throw new Error(`While: sub-workflow did not succeed (status: ${result.status})`);
      }
      const out = result.result as z.infer<TOutput>;
      return {
        inputData: state.inputData,
        outputs: [...allResults, out],
        index: state.index + 1,
        ranThisTurn: true,
      };
    },
  });

  return createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    .then(initStep)
    .dowhile(runSubStep, async ({ inputData, iterationCount }) => {
      const d = inputData as z.infer<typeof LoopStateSchema>;
      return d.ranThisTurn && iterationCount < maxIterations;
    })
    .then(
      createStep({
        id: 'prepare-synthesizer',
        inputSchema: LoopStateSchema,
        outputSchema: z.object({ inputData: z.any(), outputs: z.array(z.any()) }),
        execute: async ({ inputData }) => {
          const d = inputData as z.infer<typeof LoopStateSchema>;
          return { inputData: d.inputData, outputs: d.outputs };
        },
      }),
    )
    .then(synthesizerStep)
    .commit();
}

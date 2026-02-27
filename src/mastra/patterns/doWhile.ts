/**
 * DoWhile pattern.
 *
 * Runs a sub-workflow repeatedly while `condition` returns true. Always runs at
 * least once. Stops when condition returns false or maxIterations is reached.
 * Collects all outputs and passes them to a synthesizer step (like mapThenReduce).
 * Use when the number of iterations is not known upfront but determined by the
 * sub-workflow's output.
 *
 * NOTE: Difference from mapThenReduce:
 * - In mapThenReduce, the list is known in advance (input artifacts);
 * - In doWhile, the list is not known in advance; the loop runs while the
 *   condition holds.
 *
 * ```
 * Input ── loop: SubWorkflow(input) → collect while condition → Synthesizer(outputs) ── Output
 * ```
 *
 * @example
 * const synthesizerStep = createStep({
 *   id: "synthesize",
 *   inputSchema: z.object({ inputData: z.any(), outputs: z.array(z.any()) }),
 *   outputSchema: z.object({ best: z.string() }),
 *   execute: async ({ inputData }) => {
 *     const { outputs } = inputData as { outputs: { draft: string }[] };
 *     return { best: outputs[outputs.length - 1]!.draft };
 *   },
 * });
 * const workflow = createDoWhileWorkflow({
 *   workflowId: "do-while-refine",
 *   inputSchema: z.object({ task: z.string() }),
 *   outputSchema: z.object({ best: z.string() }),
 *   subWorkflow: draftWorkflow,
 *   // keep refining while confidence is still low
 *   condition: (index, lastResult, allResults) =>
 *     (lastResult as { confidence: number }).confidence < 0.9,
 *   maxIterations: 5,
 *   synthesizerStep,
 * });
 *
 * See docs/features/ai-crews/patterns.md#do-while
 */

import { type AnyWorkflow, createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export interface DoWhileOptions<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  workflowId: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  subWorkflow: AnyWorkflow;
  /**
   * Return true to keep running, false to stop and pass outputs to synthesizer.
   * Mirrors Array.forEach callback order: (index, lastResult, allResults).
   * `lastResult` is always defined (at least one run has completed).
   * `allResults` includes `lastResult` as its last element.
   */
  /* eslint-disable-next-line max-params -- workflow condition callback API mirrors forEach(index, item, array) */
  condition: (
    index: number,
    lastResult: z.infer<TOutput>,
    allResults: z.infer<TOutput>[],
  ) => boolean | Promise<boolean>;
  maxIterations?: number;
  /** Receives { inputData, outputs } and produces final output. */
  synthesizerStep: ReturnType<typeof createStep>;
}

const LoopStateSchema = z.object({
  inputData: z.unknown(),
  outputs: z.array(z.any()),
  index: z.number(),
});

export function createDoWhileWorkflow<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  options: DoWhileOptions<TInput, TOutput>,
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
    }),
  });

  const runSubStep = createStep({
    id: 'run-sub',
    inputSchema: LoopStateSchema,
    outputSchema: LoopStateSchema,
    execute: async ({ inputData }) => {
      const state = inputData as z.infer<typeof LoopStateSchema>;
      const run = await subWorkflow.createRun();
      const result = await run.start({ inputData: state.inputData });
      if (result.status !== 'success') {
        throw new Error(`DoWhile: sub-workflow did not succeed (status: ${result.status})`);
      }
      const out = result.result as z.infer<TOutput>;
      return {
        inputData: state.inputData,
        outputs: [...(state.outputs as z.infer<TOutput>[]), out],
        index: state.index + 1,
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
      const allResults = d.outputs as z.infer<TOutput>[];
      const lastResult = allResults.at(-1);
      const keepRunning = lastResult ? await condition(d.index - 1, lastResult, allResults) : false;
      return keepRunning && iterationCount < maxIterations;
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

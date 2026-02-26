/**
 * Map-Then-Reduce (Batch Processing) pattern.
 *
 * Applies the same agent pipeline to each item in an array (from itemsKey), runs
 * in parallel with configurable concurrency, then passes all results to an
 * aggregateStep. Use for batch summarization, classification, or parallel
 * processing of many inputs.
 *
 * ```
 * Input[items] ── foreach(Agent per item, concurrency) ── aggregateStep ── Output
 * ```
 *
 * NOTE: Difference from fanOut:
 * - In fanOut, we have 1 input sent to N agents in parallel
 * - In MapThenReduce, we have N inputs sent to 1 agent in parallel
 *
 * @example
 * const aggregateStep = createStep({
 *   id: "aggregate",
 *   inputSchema: z.array(z.object({ result: z.string(), item: z.any() })),
 *   outputSchema: z.object({ summaries: z.array(z.string()) }),
 *   execute: async ({ inputData }) => ({
 *     summaries: (inputData as { result: string }[]).map((r) => r.result),
 *   }),
 * });
 * const workflow = createMapThenReduceWorkflow({
 *   workflowId: "batch-summarize",
 *   inputSchema: z.object({ articles: z.array(z.string()) }),
 *   outputSchema: z.object({ summaries: z.array(z.string()) }),
 *   itemsKey: "articles",
 *   agent: summarizerAgent,
 *   itemPromptTemplate: "Summarize: {item}",
 *   aggregateStep,
 *   concurrency: 5,
 * });
 *
 * See docs/features/ai-crews/patterns.md#11-map-then-reduce-batch-processing
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export interface MapThenReduceOptions<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  workflowId: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  /** Key in input for array of items to process */
  itemsKey: string;
  agent: Agent;
  itemPromptTemplate: string;
  aggregateStep: ReturnType<typeof createStep>;
  concurrency?: number;
}

export function createMapThenReduceWorkflow<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(options: MapThenReduceOptions<TInput, TOutput>) {
  const {
    workflowId,
    inputSchema,
    outputSchema,
    itemsKey,
    agent,
    itemPromptTemplate,
    aggregateStep,
    concurrency = 5,
  } = options;

  const processItemStep = createStep({
    id: 'process-item',
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async ({ inputData }) => {
      const prompt = itemPromptTemplate.replace('{item}', JSON.stringify(inputData));
      const res = await agent.generate([{ role: 'user', content: prompt }]);
      return { result: res.text, item: inputData };
    },
  });

  const initStep = createStep({
    id: 'init',
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.array(z.any()),
    execute: async ({ inputData }) => {
      const init = inputData as Record<string, unknown>;
      const val = init[itemsKey];
      if (!Array.isArray(val)) {
        throw new Error(`MapThenReduce: input[${itemsKey}] must be an array, got ${typeof val}`);
      }
      return val as unknown[];
    },
  });

  return createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    .then(initStep)
    .foreach(processItemStep, { concurrency })
    .then(aggregateStep)
    .commit();
}

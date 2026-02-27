/**
 * Weighted Panel fan-out pattern.
 *
 * Like basic fan-out, but each reviewer has a configurable weight (default 1). The
 * synthesizer receives a weights note (e.g. "security: weight 2; pm: weight 1") so
 * it can prioritize certain opinions. Use for security-sensitive docs or when some
 * experts should have more influence.
 *
 * ```
 * Input ──┬── AgentA(weight) ──┐
 *         ├── AgentB(weight) ──┤── map(merge+weights) ── Synthesizer ── Output
 *         └── AgentC(weight) ──┘
 * ```
 *
 * Compared to fanOutSelective, in this pattern the weights are known in advance or static,
 * whereas in fanOutSelective the weights are dynamic and determined by the reviewers.
 *
 * @example
 * const workflow = createFanOutWeightedPanelWorkflow({
 *   workflowId: "weighted-prd-review",
 *   inputSchema: z.object({ document: z.string() }),
 *   artifactKey: "document",
 *   reviewers: [
 *     { id: "security", agent: secAgent, promptTemplate: "Review: {artifact}", weight: 2 },
 *     { id: "pm", agent: pmAgent, promptTemplate: "Review: {artifact}", weight: 1 },
 *   ],
 *   synthesizer: synthAgent,
 *   outputSchema: z.object({ summary: z.string() }),
 *   synthesizerPromptTemplate: "Artifact:\n{artifact}\n\nWeighted critiques:\n{critiques}\n\nWeights: {weights}\n\nSynthesize.",
 * });
 *
 * See docs/features/ai-crews/patterns.md#1-fan-out--parallel-panel
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export interface WeightedReviewerConfig {
  id: string;
  agent: Agent;
  promptTemplate: string;
  /** Weight for synthesis (default 1). Higher = more influence. */
  weight?: number;
}

export interface FanOutWeightedPanelOptions<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
> {
  workflowId: string;
  inputSchema: TInput;
  artifactKey: string;
  reviewers: WeightedReviewerConfig[];
  synthesizer: Agent;
  outputSchema: TOutput;
  /** Use {artifact}, {critiques}, {weights} — weights is a note to the synthesizer. */
  synthesizerPromptTemplate: string;
}

const ReviewOutput = z.object({ critique: z.string() });

export function createFanOutWeightedPanelWorkflow<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(options: FanOutWeightedPanelOptions<TInput, TOutput>) {
  const {
    workflowId,
    inputSchema,
    artifactKey,
    reviewers,
    synthesizer,
    outputSchema,
    synthesizerPromptTemplate,
  } = options;

  if (reviewers.length === 0) {
    throw new Error('FanOutWeightedPanel requires at least one reviewer');
  }

  const reviewSteps = reviewers.map((r) =>
    createStep({
      id: r.id,
      inputSchema: z.object({ [artifactKey]: z.string() }),
      outputSchema: ReviewOutput,
      execute: async ({ inputData }) => {
        const artifact = (inputData as Record<string, string>)[artifactKey] ?? '';
        const prompt = r.promptTemplate.replace('{artifact}', artifact);
        const res = await r.agent.generate([{ role: 'user', content: prompt }]);
        return { critique: res.text };
      },
    }),
  );

  const synthesizerStep = createStep({
    id: 'synthesizer',
    inputSchema: z.object({
      [artifactKey]: z.string(),
      critiques: z.string(),
      weightsNote: z.string(),
    }),
    outputSchema: outputSchema as z.ZodTypeAny,
    execute: async ({ inputData }) => {
      const data = inputData as Record<string, string>;
      const prompt = synthesizerPromptTemplate
        .replace('{artifact}', data[artifactKey] ?? '')
        .replace('{critiques}', data.critiques ?? '')
        .replace('{weights}', data.weightsNote ?? '');
      const res = await synthesizer.generate([{ role: 'user', content: prompt }], {
        structuredOutput: { schema: outputSchema },
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- Mastra structuredOutput; schema validated at runtime
      return res.object;
    },
  });

  const weightsNote = reviewers.map((r) => `${r.id}: weight ${r.weight ?? 1}`).join('; ');

  return createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    .parallel(reviewSteps)
    .map(async ({ inputData, getInitData }) => {
      const init = getInitData<Record<string, string>>();
      const parallelOut = inputData as Record<string, { critique: string }>;
      const blocks = reviewers.map((r) => {
        const w = r.weight ?? 1;
        const label = w !== 1 ? `## ${r.id} (weight: ${w})\n` : `## ${r.id}\n`;
        return label + (parallelOut[r.id]?.critique ?? '');
      });
      return {
        [artifactKey]: init[artifactKey] ?? '',
        critiques: blocks.join('\n\n---\n\n'),
        weightsNote,
      };
    })
    .then(synthesizerStep)
    .commit();
}

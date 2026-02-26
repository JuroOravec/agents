/**
 * Fan-Out Selective pattern.
 *
 * The artifact is broadcast to all experts in parallel. Optionally, expertsKey in the
 * input selects which experts' outputs to use (otherwise all). A filterAndRank
 * function can reorder or filter critiques before synthesis. Use when you have many
 * experts but want to limit or prioritize whose output goes to the synthesizer.
 *
 * ```
 * Input ──┬── ExpertA ──┐
 *         ├── ExpertB ──┤── filterAndRank ── map(merge) ── Synthesizer ── Output
 *         └── ExpertC ──┘
 * ```
 *
 * Compared to fanOutWeightedPanel, in this pattern the weights are dynamic and
 * determined at runtime (via filterAndRank or expertsKey), whereas in
 * fanOutWeightedPanel the weights are static and known in advance.
 *
 * @example
 * const workflow = createFanOutSelectiveWorkflow({
 *   workflowId: "selective-review",
 *   inputSchema: z.object({ document: z.string(), expertIds: z.array(z.string()).optional() }),
 *   artifactKey: "document",
 *   expertsKey: "expertIds",
 *   experts: [
 *     { id: "sec", agent: secAgent, promptTemplate: "Security review: {artifact}" },
 *     { id: "ux", agent: uxAgent, promptTemplate: "UX review: {artifact}" },
 *   ],
 *   synthesizer: synthAgent,
 *   outputSchema: z.object({ summary: z.string() }),
 *   synthesizerPromptTemplate: "Artifact:\n{artifact}\n\nCritiques:\n{critiques}\n\nSynthesize.",
 *   filterAndRank: (outs) => outs.slice(0, 3),
 * });
 *
 * See docs/features/ai-crews/patterns.md#7-fan-out-selective
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export interface FanOutSelectiveExpertConfig {
  id: string;
  agent: Agent;
  promptTemplate: string;
}

export interface FanOutSelectiveOptions<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  workflowId: string;
  inputSchema: TInput;
  artifactKey: string;
  /** Key in input for array of expert ids to query (or undefined = use all experts) */
  expertsKey?: string;
  experts: FanOutSelectiveExpertConfig[];
  synthesizer: Agent;
  outputSchema: TOutput;
  synthesizerPromptTemplate: string;
  /** Filter/rank function. Receives all outputs; returns filtered+ranked for synthesis. */
  filterAndRank?: (
    outputs: { id: string; critique: string }[],
  ) => { id: string; critique: string }[];
}

const ExpertOutputSchema = z.object({
  critique: z.string(),
  relevanceScore: z.number().optional(),
});

export function createFanOutSelectiveWorkflow<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(options: FanOutSelectiveOptions<TInput, TOutput>) {
  const {
    workflowId,
    inputSchema,
    artifactKey,
    expertsKey,
    experts,
    synthesizer,
    outputSchema,
    synthesizerPromptTemplate,
    filterAndRank = (outs) => outs,
  } = options;

  if (experts.length === 0) {
    throw new Error('FanOutSelective requires at least one expert');
  }

  /** Resolve which experts to run: from expertsKey if set, else all. */
  const getExpertIds = (init: Record<string, unknown>): string[] => {
    if (!expertsKey) return experts.map((e) => e.id);
    const val = init[expertsKey];
    if (!Array.isArray(val)) return experts.map((e) => e.id);
    return val.filter(
      (id): id is string => typeof id === 'string' && experts.some((e) => e.id === id),
    );
  };

  const expertSteps = experts.map((e) =>
    createStep({
      id: e.id,
      inputSchema: z.object({ [artifactKey]: z.string() }),
      outputSchema: ExpertOutputSchema,
      execute: async ({ inputData }) => {
        const artifact = (inputData as Record<string, string>)[artifactKey] ?? '';
        const prompt = e.promptTemplate.replace('{artifact}', artifact);
        const res = await e.agent.generate([{ role: 'user', content: prompt }]);
        return { critique: res.text, relevanceScore: 1 };
      },
    }),
  );

  const synthesizerStep = createStep({
    id: 'synthesizer',
    inputSchema: z.object({ [artifactKey]: z.string(), critiques: z.string() }),
    outputSchema: outputSchema as z.ZodTypeAny,
    execute: async ({ inputData }) => {
      const data = inputData as Record<string, string>;
      const prompt = synthesizerPromptTemplate
        .replace('{artifact}', data[artifactKey] ?? '')
        .replace('{critiques}', data.critiques ?? '');
      const res = await synthesizer.generate([{ role: 'user', content: prompt }], {
        structuredOutput: { schema: outputSchema },
      });
      return res.object;
    },
  });

  return (
    createWorkflow({
      id: workflowId,
      inputSchema: inputSchema as z.ZodTypeAny,
      outputSchema: outputSchema as z.ZodTypeAny,
    })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mastra .parallel() tuple type
      .parallel(expertSteps as any)
      .map(async ({ inputData, getInitData }) => {
        const init = getInitData<Record<string, unknown>>();
        const artifact = String(init[artifactKey] ?? '');
        const expertIds = getExpertIds(init);
        const parallelOut = inputData as Record<string, { critique: string }>;
        const outputs = expertIds.map((id) => ({ id, critique: parallelOut[id]?.critique ?? '' }));
        const filtered = filterAndRank(outputs);
        const critiques = filtered.map((o) => `## ${o.id}\n${o.critique}`).join('\n\n---\n\n');
        return { [artifactKey]: artifact, critiques };
      })
      .then(synthesizerStep)
      .commit()
  );
}

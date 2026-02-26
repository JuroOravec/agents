/**
 * Fan-Out / Parallel Panel (Map-Reduce) pattern.
 *
 * One artifact is sent to N specialist agents who review it in parallel. A synthesizer
 * merges their critiques into a single output. Reviewers do not interact—each sees
 * only the original artifact. Best for independent expert review (e.g. PRD review
 * by architect, security, PM).
 *
 * ```
 * Input ──┬── AgentA ──┐
 *         ├── AgentB ──┤── map(merge) ── Synthesizer ── Output
 *         └── AgentC ──┘
 * ```
 *
 * @example
 * const workflow = createFanOutWorkflow({
 *   workflowId: "prd-review",
 *   inputSchema: z.object({ document: z.string() }),
 *   artifactKey: "document",
 *   reviewers: [
 *     { id: "architect", agent: archAgent, promptTemplate: "Review architecture: {artifact}" },
 *     { id: "security", agent: secAgent, promptTemplate: "Review security: {artifact}" },
 *   ],
 *   synthesizer: synthAgent,
 *   outputSchema: z.object({ summary: z.string(), recommendations: z.array(z.string()) }),
 *   synthesizerPromptTemplate: "Artifact:\n{artifact}\n\nCritiques:\n{critiques}\n\nSynthesize.",
 * });
 *
 * See docs/features/ai-crews/patterns.md#1-fan-out--parallel-panel-map-reduce
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

/** Config for a single reviewer agent in the fan-out. */
export interface ReviewerConfig {
  id: string;
  agent: Agent;
  /** Prompt template; {artifact} is replaced with the artifact content. */
  promptTemplate: string;
}

/** Options for creating a fan-out workflow. */
export interface FanOutOptions<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  workflowId: string;
  inputSchema: TInput;
  /** Key in input that holds the artifact to review (e.g. "prd_document") */
  artifactKey: string;
  reviewers: ReviewerConfig[];
  synthesizer: Agent;
  outputSchema: TOutput;
  /** Synthesizer prompt template: {artifact}, {critiques} */
  synthesizerPromptTemplate: string;
}

const ReviewOutput = z.object({ critique: z.string() });

/**
 * Creates a fan-out (parallel panel) workflow.
 * Reviewers run in parallel; synthesizer merges their outputs.
 */
export function createFanOutWorkflow<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  options: FanOutOptions<TInput, TOutput>,
) {
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
    throw new Error('FanOut requires at least one reviewer');
  }

  const reviewSteps = reviewers.map((r) =>
    createStep({
      id: r.id,
      inputSchema: z.object({ [artifactKey]: z.string() }) as z.ZodType<Record<string, string>>,
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
    }),
    outputSchema: outputSchema as z.ZodTypeAny,
    execute: async ({ inputData }) => {
      const artifact = (inputData as Record<string, string>)[artifactKey] ?? '';
      const critiques = (inputData as Record<string, string>).critiques ?? '';
      const prompt = synthesizerPromptTemplate
        .replace('{artifact}', artifact)
        .replace('{critiques}', critiques);
      const res = await synthesizer.generate([{ role: 'user', content: prompt }], {
        structuredOutput: { schema: outputSchema },
      });
      return res.object;
    },
  });

  const workflow = createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .parallel(reviewSteps as any)
    .map(async ({ inputData, getInitData }) => {
      const init = getInitData<Record<string, string>>();
      const artifact = init[artifactKey] ?? '';
      const parallelOut = inputData as Record<string, { critique: string }>;
      const critiqueBlocks = reviewers.map(
        (r) => `## ${r.id}\n${parallelOut[r.id]?.critique ?? ''}`,
      );
      const critiques = critiqueBlocks.join('\n\n---\n\n');
      return { [artifactKey]: artifact, critiques };
    })
    .then(synthesizerStep)
    .commit();

  return workflow;
}

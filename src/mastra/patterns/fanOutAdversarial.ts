/**
 * Adversarial Fan-Out pattern.
 *
 * Like basic fan-out, but two agents are seeded with opposing priors: one argues for
 * the proposal (advocate), one argues against (devil's advocate). Both run in parallel
 * with optional neutral reviewers. The synthesizer reconciles both views. Useful for
 * stress-testing proposals and surfacing risks.
 *
 * ```
 * Input ──┬── Advocate ──┐
 *         ├── Adversary ─┼── map(merge) ── Synthesizer ── Output
 *         └── [optional neutrals] ─┘
 * ```
 *
 * @example
 * const workflow = createFanOutAdversarialWorkflow({
 *   workflowId: "adversarial-review",
 *   inputSchema: z.object({ proposal: z.string() }),
 *   artifactKey: "proposal",
 *   advocate: { id: "advocate", agent: advAgent, role: ADVOCATE_ROLE },
 *   adversary: { id: "adversary", agent: advyAgent, role: ADVERSARY_ROLE },
 *   synthesizer: synthAgent,
 *   outputSchema: z.object({ verdict: z.string(), risks: z.array(z.string()) }),
 *   synthesizerPromptTemplate: "Proposal:\n{artifact}\n\nAdvocacy & critique:\n{critiques}\n\nSynthesize.",
 * });
 *
 * See docs/features/ai-crews/patterns.md#1-fan-out--parallel-panel
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

/** Advocates for the proposal. */
export const ADVOCATE_ROLE = 'advocate' as const;
/** Argues against the proposal (devil's advocate). */
export const ADVERSARY_ROLE = 'adversary' as const;

export interface AdversarialReviewerConfig {
  id: string;
  agent: Agent;
  role: typeof ADVOCATE_ROLE | typeof ADVERSARY_ROLE;
  /** Extra instructions for this role. */
  roleInstructions?: string;
}

export interface FanOutAdversarialOptions<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
> {
  workflowId: string;
  inputSchema: TInput;
  artifactKey: string;
  advocate: AdversarialReviewerConfig;
  adversary: AdversarialReviewerConfig;
  /** Optional additional neutral reviewers. */
  extraReviewers?: { id: string; agent: Agent; promptTemplate: string }[];
  synthesizer: Agent;
  outputSchema: TOutput;
  synthesizerPromptTemplate: string;
}

const ReviewOutput = z.object({ critique: z.string() });

const ADVOCATE_PROMPT = `You are an advocate for this proposal. Argue for its strengths and defend it against potential criticism. Be constructive but enthusiastic.

{artifact}

Provide your advocacy in markdown.`;

const ADVERSARY_PROMPT = `You are a devil's advocate. Critically challenge this proposal. Surface risks, weaknesses, and blind spots. Be rigorous but fair.

{artifact}

Provide your critique in markdown.`;

export function createFanOutAdversarialWorkflow<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(options: FanOutAdversarialOptions<TInput, TOutput>) {
  const {
    workflowId,
    inputSchema,
    artifactKey,
    advocate,
    adversary,
    extraReviewers = [],
    synthesizer,
    outputSchema,
    synthesizerPromptTemplate,
  } = options;

  if (advocate.id === adversary.id) {
    throw new Error('FanOutAdversarial: advocate and adversary must have distinct ids');
  }

  const advPrompt = (
    advocate.roleInstructions
      ? `${ADVOCATE_PROMPT}\n\n${advocate.roleInstructions}`
      : ADVOCATE_PROMPT
  ).replace('{artifact}', `{{artifact}}`);
  const advStep = createStep({
    id: advocate.id,
    inputSchema: z.object({ [artifactKey]: z.string() }),
    outputSchema: ReviewOutput,
    execute: async ({ inputData }) => {
      const artifact = (inputData as Record<string, string>)[artifactKey] ?? '';
      const prompt = advPrompt.replace('{{artifact}}', artifact);
      const res = await advocate.agent.generate([{ role: 'user', content: prompt }]);
      return { critique: res.text };
    },
  });

  const advyPrompt = (
    adversary.roleInstructions
      ? `${ADVERSARY_PROMPT}\n\n${adversary.roleInstructions}`
      : ADVERSARY_PROMPT
  ).replace('{artifact}', `{{artifact}}`);
  const advyStep = createStep({
    id: adversary.id,
    inputSchema: z.object({ [artifactKey]: z.string() }),
    outputSchema: ReviewOutput,
    execute: async ({ inputData }) => {
      const artifact = (inputData as Record<string, string>)[artifactKey] ?? '';
      const prompt = advyPrompt.replace('{{artifact}}', artifact);
      const res = await adversary.agent.generate([{ role: 'user', content: prompt }]);
      return { critique: res.text };
    },
  });

  const extraSteps = extraReviewers.map((r) =>
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

  const allSteps = [advStep, advyStep, ...extraSteps];
  const allIds = [advocate.id, adversary.id, ...extraReviewers.map((e) => e.id)];

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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- Mastra structuredOutput; schema validated at runtime
      return res.object;
    },
  });

  return createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    .parallel(allSteps)
    .map(async ({ inputData, getInitData }) => {
      const init = getInitData<Record<string, string>>();
      const parallelOut = inputData as Record<string, { critique: string }>;
      const blocks = allIds.map((id) => `## ${id}\n${parallelOut[id]?.critique ?? ''}`);
      return {
        [artifactKey]: init[artifactKey] ?? '',
        critiques: blocks.join('\n\n---\n\n'),
      };
    })
    .then(synthesizerStep)
    .commit();
}

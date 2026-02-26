/**
 * Router pattern.
 *
 * A router agent analyzes the input and selects one specialist (by id). The workflow
 * branches to that specialist's step; a fallback runs if the selection doesn't match
 * any branch. Only one specialist runs per input—good for routing by topic, language,
 * or complexity without invoking all experts.
 *
 * ```
 *              ┌── selectedId=tech ── TechAgent ──┐
 * Input ─── Router ── branch ──┤                  ├── Output
 *              └── (else) ── Fallback ────────────┘
 * ```
 *
 * @example
 * const workflow = createRouterWorkflow({
 *   workflowId: "router",
 *   inputSchema: z.object({ query: z.string() }),
 *   inputKey: "query",
 *   router: routerAgent,
 *   branches: [
 *     { id: "tech", agent: techAgent, promptTemplate: "Answer: {input}" },
 *     { id: "general", agent: generalAgent, promptTemplate: "Answer: {input}" },
 *   ],
 *   outputSchema: z.object({ answer: z.string() }),
 * });
 *
 * See docs/features/ai-crews/patterns.md#15-router
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export interface RouterBranchConfig {
  id: string;
  agent: Agent;
  promptTemplate: string;
}

export interface RouterOptions<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  workflowId: string;
  inputSchema: TInput;
  inputKey: string;
  router: Agent;
  /** Router returns JSON: { selectedId: string } */
  branches: RouterBranchConfig[];
  outputSchema: TOutput;
}

export function createRouterWorkflow<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  options: RouterOptions<TInput, TOutput>,
) {
  const { workflowId, inputSchema, inputKey, router, branches, outputSchema } = options;

  if (branches.length === 0) {
    throw new Error('Router requires at least one branch');
  }

  const routerStep = createStep({
    id: 'router',
    inputSchema: z.object({ input: z.string() }),
    outputSchema: z.object({ input: z.string(), selectedId: z.string() }),
    execute: async ({ inputData }) => {
      const input = (inputData as { input: string }).input;
      const ids = branches.map((b) => b.id).join(', ');
      const prompt = `Analyze this input and select the best specialist. Reply JSON: { "selectedId": "id" }. Options: ${ids}\n\nInput:\n${input}`;
      const res = await router.generate([{ role: 'user', content: prompt }], {
        structuredOutput: { schema: z.object({ selectedId: z.string() }) },
      });
      return { input, selectedId: (res.object as { selectedId: string }).selectedId };
    },
  });

  const branchSteps = branches.map((b) =>
    createStep({
      id: b.id,
      inputSchema: z.object({ input: z.string(), selectedId: z.string() }),
      outputSchema: outputSchema as z.ZodTypeAny,
      execute: async ({ inputData }) => {
        const { input } = inputData as { input: string };
        const prompt = b.promptTemplate.replace('{input}', input);
        const res = await b.agent.generate([{ role: 'user', content: prompt }], {
          structuredOutput: { schema: outputSchema },
        });
        return res.object;
      },
    }),
  );

  const fallbackStep = createStep({
    id: 'fallback',
    inputSchema: z.object({ input: z.string(), selectedId: z.string() }),
    outputSchema: outputSchema as z.ZodTypeAny,
    execute: async ({ inputData }) => {
      const { input } = inputData as { input: string };
      const b = branches[0]!;
      const prompt = b.promptTemplate.replace('{input}', input);
      const res = await b.agent.generate([{ role: 'user', content: prompt }], {
        structuredOutput: { schema: outputSchema },
      });
      return res.object;
    },
  });

  const conds = branches.map(
    (b) =>
      [
        async ({ inputData }: { inputData: { selectedId: string } }) =>
          inputData.selectedId === b.id,
        branchSteps.find((s) => s.id === b.id)!,
      ] as const,
  );
  conds.push([async () => true, fallbackStep] as const);

  const initStep = createStep({
    id: 'init',
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.object({ input: z.string() }),
    execute: async ({ inputData }) => {
      const init = inputData as Record<string, unknown>;
      return { input: String(init[inputKey] ?? '') };
    },
  });

  return (
    createWorkflow({
      id: workflowId,
      inputSchema: inputSchema as z.ZodTypeAny,
      outputSchema: outputSchema as z.ZodTypeAny,
    })
      .then(initStep)
      .then(routerStep)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mastra .branch() tuple type
      .branch(conds as any)
      .commit()
  );
}

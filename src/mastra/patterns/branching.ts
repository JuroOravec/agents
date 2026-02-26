/**
 * Branching (Conditional Routing) pattern.
 *
 * A condition step runs first; its output determines which branch executes. Each branch
 * is a (condition, step) pair; the first matching condition wins. Optional mergeStep
 * combines branch outputs. Use for routing by type, priority, or other predicates.
 *
 * ```
 *          ┌── (cond1) ── StepA ──┐
 * Input ─── Condition ──┤        ├── [mergeStep?] ── Output
 *          └── (cond2) ── StepB ──┘
 * ```
 *
 * @example
 * const classifyStep = createStep({ id: "classify", ... });
 * const workflow = createBranchingWorkflow({
 *   workflowId: "branching",
 *   inputSchema: z.object({ query: z.string() }),
 *   outputSchema: z.object({ answer: z.string() }),
 *   conditionStep: classifyStep,
 *   branches: [
 *     { condition: async ({ inputData }) => (inputData as { type: string }).type === "technical", step: techStep },
 *     { condition: async () => true, step: fallbackStep },
 *   ],
 *   mergeStep,
 * });
 *
 * See docs/features/ai-crews/patterns.md#8-branching-conditional-routing
 */

import { createWorkflow, type Step } from '@mastra/core/workflows';
import type { z } from 'zod';

export type BranchCondition = (params: { inputData: unknown }) => Promise<boolean>;

export interface BranchConfig<TOutput = unknown> {
  condition: BranchCondition;
  step: Step<string, unknown, unknown, TOutput, unknown, unknown, unknown, unknown>;
}

export interface BranchingOptions<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  workflowId: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  conditionStep: Step<string, unknown, unknown, unknown, unknown, unknown, unknown, unknown>;
  branches: BranchConfig[];
  mergeStep?: Step<string, unknown, unknown, TOutput, unknown, unknown, unknown, unknown>;
}

export function createBranchingWorkflow<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  options: BranchingOptions<TInput, TOutput>,
) {
  const { workflowId, inputSchema, outputSchema, conditionStep, branches, mergeStep } = options;

  if (branches.length === 0) {
    throw new Error('Branching requires at least one branch');
  }

  const branchEntries = branches.map((b) => [b.condition, b.step] as const);

  let workflow = createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    .then(conditionStep)
    // Mastra .branch() expects complex tuple types; branchEntries matches at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mastra .branch() tuple type
    .branch(branchEntries as any);

  if (mergeStep) {
    workflow = workflow.then(mergeStep);
  }

  return workflow.commit();
}

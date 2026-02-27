/**
 * Evaluator-Optimizer (Actor-Critic) pattern.
 *
 * A generator produces a draft; an evaluator scores it (approved/rejected + feedback). If
 * rejected, the generator retries with the feedback. Loop exits when approved or after
 * maxRetries. Good for iterative refinement (e.g. code generation, document drafting)
 * where quality gates matter.
 *
 * ```
 *       ┌───────────────────────────────────┐
 *       ↓ rejected + feedback                │
 * Input ── Generator ── Draft ── Evaluator ──┤
 *                                           │ approved
 *                                           └── Output
 * ```
 *
 * @example
 * const workflow = createEvaluatorOptimizerWorkflow({
 *   workflowId: "actor-critic",
 *   inputSchema: z.object({ task_description: z.string() }),
 *   taskKey: "task_description",
 *   generator: genAgent,
 *   evaluator: evalAgent,
 *   generatorPromptTemplate: "Task: {task}\nDraft so far: {draft}\nFeedback: {feedback}\n\nProduce improved draft.",
 *   evaluatorPromptTemplate: "Task: {task}\nDraft: {draft}\n\nEvaluate: reply { approved: true|false, feedback?: string }",
 *   outputSchema: z.object({ result: z.string(), iterations: z.number() }),
 *   maxRetries: 3,
 * });
 *
 * See docs/features/ai-crews/patterns.md#3-evaluator-optimizer-actor-critic-loop
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export const EvaluationSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
});

export type Evaluation = z.infer<typeof EvaluationSchema>;

export interface EvaluatorOptimizerOptions<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
> {
  workflowId: string;
  inputSchema: TInput;
  /** Key in input for the task/context (e.g. "task_description") */
  taskKey: string;
  generator: Agent;
  evaluator: Agent;
  generatorPromptTemplate: string;
  evaluatorPromptTemplate: string;
  outputSchema: TOutput;
  maxRetries?: number;
}

const LoopStateSchema = z.object({
  task: z.string(),
  draft: z.string(),
  feedback: z.string(),
  iteration: z.number(),
  approved: z.boolean(),
});

export function createEvaluatorOptimizerWorkflow<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(options: EvaluatorOptimizerOptions<TInput, TOutput>) {
  const {
    workflowId,
    inputSchema,
    taskKey,
    generator,
    evaluator,
    generatorPromptTemplate,
    evaluatorPromptTemplate,
    outputSchema,
    maxRetries = 3,
  } = options;

  const initStep = createStep({
    id: 'init',
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: LoopStateSchema,
    execute: async ({ inputData }) => {
      const init = inputData as Record<string, unknown>;
      const task = String(init[taskKey] ?? '');
      return { task, draft: '', feedback: '', iteration: 0, approved: false };
    },
  });

  const loopStep = createStep({
    id: 'generate-then-evaluate',
    inputSchema: LoopStateSchema,
    outputSchema: LoopStateSchema,
    execute: async ({ inputData }) => {
      const state = inputData as z.infer<typeof LoopStateSchema>;
      const genPrompt = generatorPromptTemplate
        .replace('{task}', state.task)
        .replace('{draft}', state.draft || '(none)')
        .replace('{feedback}', state.feedback || '(none)');
      const genRes = await generator.generate([{ role: 'user', content: genPrompt }], {
        structuredOutput: { schema: z.object({ draft: z.string() }) },
      });
      const draft = (genRes.object as { draft: string }).draft;
      const evalPrompt = evaluatorPromptTemplate
        .replace('{task}', state.task)
        .replace('{draft}', draft);
      const evalRes = await evaluator.generate([{ role: 'user', content: evalPrompt }], {
        structuredOutput: { schema: EvaluationSchema },
      });
      const ev = evalRes.object as Evaluation;
      return {
        task: state.task,
        draft,
        feedback: ev.feedback ?? '',
        iteration: state.iteration + 1,
        approved: ev.approved,
      };
    },
  });

  const finalizeStep = createStep({
    id: 'finalize',
    inputSchema: LoopStateSchema,
    outputSchema: outputSchema as z.ZodTypeAny,
    execute: async ({ inputData }) => {
      const state = inputData as z.infer<typeof LoopStateSchema>;
      const out = { result: state.draft, iterations: state.iteration };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- Mastra outputSchema parse; ZodTypeAny for workflow API
      return (outputSchema as z.ZodTypeAny).parse(out) as z.infer<typeof outputSchema>;
    },
  });

  return createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    .then(initStep)
    .dountil(loopStep, async ({ inputData, iterationCount }) => {
      const state = inputData as z.infer<typeof LoopStateSchema>;
      const done = state.approved || iterationCount >= maxRetries;
      return done;
    })
    .then(finalizeStep)
    .commit();
}

/**
 * Orchestrator pattern.
 *
 * An orchestrator loop: on each iteration, a router agent sees the original task and the
 * full history of work done so far, then decides which worker to invoke next and emits
 * a focused directive for that worker. The chosen worker runs, appends its output to
 * history, and the loop continues until the router signals done or maxIterations is reached.
 *
 * Each worker's promptTemplate supports three placeholders:
 *   {task}      — the original task (unchanged throughout)
 *   {history}   — everything workers have produced so far
 *   {directive} — a targeted instruction from the orchestrator for this specific delegation
 *                 (e.g. "focus on WebGL support and GPU memory constraints")
 *
 * An optional synthesizerStep can produce structured output from the final
 * { task, history }; without it the raw history is returned as { result, task }.
 *
 * ```
 *          ┌───────────────────────────────────────────┐
 *          ↓                                           │
 * Orchestrator ── branch ──┬── WorkerA ───────────────┤
 *                          ├── WorkerB ───────────────┤
 *                          └── done? ── Synthesizer ── Output
 * ```
 *
 * When to use:
 * - The set of possible workers is known upfront (registered at creation time).
 * - The task has a clear, recognisable done state.
 * - The number of delegations is small and bounded (typically 3–8 steps).
 * - The steps needed are not fully known in advance — the orchestrator discovers them
 *   from each worker's output.
 *
 * When NOT to use:
 * - Workers need to be invented dynamically (open-ended exploration).
 * - The task is so large it must be decomposed into a tracked list of sub-tasks
 *   (use a planning phase + structured task queue instead).
 *
 * @example <caption>Research + write report (with directive + structured output)</caption>
 * // The orchestrator emits a targeted directive on each delegation, e.g.:
 * //   researcher  → "focus on Pinecone, Weaviate, Qdrant — gather pricing and scalability data"
 * //   writer      → "write an executive-summary section first, then deep-dives per vendor"
 * //   fact-checker → "verify the pricing figures and benchmark claims only"
 * const synthesizerStep = createStep({
 *   id: "synthesize",
 *   inputSchema: z.object({ task: z.string(), history: z.string() }),
 *   outputSchema: z.object({ report: z.string(), confidence: z.number() }),
 *   execute: async ({ inputData }) => {
 *     const { task, history } = inputData as { task: string; history: string };
 *     const res = await synthAgent.generate(
 *       [{ role: "user", content: `Task: ${task}\n\nWork done:\n${history}\n\nProduce final report.` }],
 *       { structuredOutput: { schema: z.object({ report: z.string(), confidence: z.number() }) } },
 *     );
 *     return res.object as { report: string; confidence: number };
 *   },
 * });
 * const workflow = createOrchestratorWorkflow({
 *   workflowId: "research-report",
 *   inputSchema: z.object({ task: z.string() }),
 *   taskKey: "task",
 *   router: orchestratorAgent,
 *   workers: [
 *     { id: "researcher",   agent: researchAgent, promptTemplate: "Task: {task}\nDirective: {directive}\nHistory: {history}\nGather facts." },
 *     { id: "writer",       agent: writerAgent,   promptTemplate: "Task: {task}\nDirective: {directive}\nHistory: {history}\nDraft the report." },
 *     { id: "fact-checker", agent: checkerAgent,  promptTemplate: "Task: {task}\nDirective: {directive}\nHistory: {history}\nVerify claims." },
 *   ],
 *   outputSchema: z.object({ report: z.string(), confidence: z.number() }),
 *   synthesizerStep,
 *   maxIterations: 8,
 * });
 *
 * @example <caption>Support ticket triage (no synthesizer — raw history output)</caption>
 * const workflow = createOrchestratorWorkflow({
 *   workflowId: "support-triage",
 *   inputSchema: z.object({ ticket: z.string() }),
 *   taskKey: "ticket",
 *   router: orchestratorAgent,
 *   workers: [
 *     { id: "billing",        agent: billingAgent, promptTemplate: "Ticket: {task}\nDirective: {directive}\nHistory: {history}\nInvestigate charge." },
 *     { id: "technical",      agent: techAgent,    promptTemplate: "Ticket: {task}\nDirective: {directive}\nHistory: {history}\nDiagnose failure." },
 *     { id: "communications", agent: commsAgent,   promptTemplate: "Ticket: {task}\nDirective: {directive}\nHistory: {history}\nDraft customer reply." },
 *   ],
 *   outputSchema: z.object({ result: z.string(), task: z.string() }),
 *   maxIterations: 5,
 * });
 *
 * See docs/features/ai-crews/patterns.md#6-orchestrator
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export interface OrchestratorWorkerConfig {
  id: string;
  agent: Agent;
  /**
   * Supports {task}, {history}, and {directive} placeholders.
   * {directive} is a focused per-delegation instruction from the orchestrator.
   */
  promptTemplate: string;
}

export interface OrchestratorOptions<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  workflowId: string;
  inputSchema: TInput;
  taskKey: string;
  router: Agent;
  workers: OrchestratorWorkerConfig[];
  outputSchema: TOutput;
  /**
   * Optional step to synthesize structured output from { task, history }.
   * inputSchema must accept z.object({ task: z.string(), history: z.string() }).
   * If omitted, returns { result: history, task } directly.
   */
  synthesizerStep?: ReturnType<typeof createStep>;
  maxIterations?: number;
}

const StateSchema = z.object({
  task: z.string(),
  history: z.string(),
  /** Targeted instruction emitted by the orchestrator for the current delegation. */
  directive: z.string(),
  done: z.boolean(),
});

const SynthInputSchema = z.object({ task: z.string(), history: z.string() });

export function createOrchestratorWorkflow<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(options: OrchestratorOptions<TInput, TOutput>) {
  const {
    workflowId,
    inputSchema,
    taskKey,
    router,
    workers,
    outputSchema,
    synthesizerStep,
    maxIterations = 5,
  } = options;

  const workerById = new Map(workers.map((w) => [w.id, w]));

  const orchestratorStep = createStep({
    id: 'orchestrator',
    inputSchema: StateSchema,
    outputSchema: StateSchema,
    execute: async ({ inputData }) => {
      const { task, history, done } = inputData as z.infer<typeof StateSchema>;
      if (done) return { task, history, directive: '', done: true };

      const routerPrompt = [
        `Task: ${task}`,
        `History:\n${history || '(none)'}`,
        `Available workers: ${workers.map((w) => w.id).join(', ')}`,
        `Reply JSON: { "nextWorker": "<id>" | null, "directive": "<focused instruction for that worker>", "done": true | false }`,
        `Set done=true when the task is fully complete. directive should be a specific, actionable instruction for the chosen worker.`,
      ].join('\n\n');

      const routerRes = await router.generate([{ role: 'user', content: routerPrompt }], {
        structuredOutput: {
          schema: z.object({
            nextWorker: z.string().nullable(),
            directive: z.string(),
            done: z.boolean(),
          }),
        },
      });
      const {
        nextWorker,
        directive,
        done: shouldDone,
      } = routerRes.object as {
        nextWorker: string | null;
        directive: string;
        done: boolean;
      };

      if (shouldDone || !nextWorker) {
        return { task, history, directive: '', done: true };
      }

      const worker = workerById.get(nextWorker);
      if (!worker) {
        return { task, history, directive: '', done: true };
      }

      const workerPrompt = worker.promptTemplate
        .replace('{task}', task)
        .replace('{history}', history || '(none)')
        .replace('{directive}', directive || '(no specific directive)');
      const workerRes = await worker.agent.generate([{ role: 'user', content: workerPrompt }]);
      const newBlock = `## ${worker.id}\n${workerRes.text}`;
      const newHistory = history ? `${history}\n\n---\n\n${newBlock}` : newBlock;
      return { task, history: newHistory, directive, done: false };
    },
  });

  const prepSynthStep = createStep({
    id: 'prepare-synthesizer',
    inputSchema: StateSchema,
    outputSchema: SynthInputSchema,
    execute: async ({ inputData }) => {
      const { task, history } = inputData as z.infer<typeof StateSchema>;
      return { task, history };
    },
  });

  const defaultFinalizeStep = createStep({
    id: 'finalize',
    inputSchema: SynthInputSchema,
    outputSchema: outputSchema as z.ZodTypeAny,
    execute: async ({ inputData }) => {
      const { task, history } = inputData as { task: string; history: string };
      const out = { result: history, task };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- Mastra outputSchema parse; ZodTypeAny for workflow API
      return (outputSchema as z.ZodTypeAny).parse(out) as z.infer<typeof outputSchema>;
    },
  });

  const initStep = createStep({
    id: 'init',
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: StateSchema,
    execute: async ({ inputData }) => {
      const init = inputData as Record<string, unknown>;
      const task = String(init[taskKey] ?? '');
      return { task, history: '', directive: '', done: false };
    },
  });

  return createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    .then(initStep)
    .dowhile(orchestratorStep, async ({ inputData, iterationCount }) => {
      const d = inputData as { done?: boolean };
      if (d.done) return false;
      if (iterationCount >= maxIterations) return false;
      return true;
    })
    .then(prepSynthStep)
    .then(synthesizerStep ?? defaultFinalizeStep)
    .commit();
}

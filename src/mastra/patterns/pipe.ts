/**
 * Pipe (Sequential Conference / Pass the baton) pattern.
 *
 * Agents review in sequence: A reviews the artifact, B reviews the artifact plus A's
 * output, C reviews plus A and B, and so on. Each agent sees prior outputs but cannot
 * respond back. A synthesizer produces the final output. Good for staged refinement
 * (e.g. architecture → implementation → QA).
 *
 * ```
 * Input ── AgentA ── AgentB(sees A) ── AgentC(sees A+B) ── Synthesizer ── Output
 * ```
 *
 * @example
 * const workflow = createPipeWorkflow({
 *   workflowId: "pipe-review",
 *   inputSchema: z.object({ spec: z.string() }),
 *   artifactKey: "spec",
 *   agents: [
 *     { id: "arch", agent: archAgent, promptTemplate: "Design architecture. Artifact: {artifact}\nPrior: {priorOutput}" },
 *     { id: "impl", agent: implAgent, promptTemplate: "Propose impl. Artifact: {artifact}\nPrior: {priorOutput}" },
 *   ],
 *   synthesizer: synthAgent,
 *   outputSchema: z.object({ design: z.string() }),
 * });
 *
 * See docs/features/ai-crews/patterns.md#2-pipe
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

const ThreadSchema = z.object({ artifact: z.string(), thread: z.string() });

/** Config for one agent in the pipe. */
export interface PipeAgentConfig {
  id: string;
  agent: Agent;
  /** Prompt: {artifact}, {priorOutput} */
  promptTemplate: string;
}

export interface PipeOptions<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  workflowId: string;
  inputSchema: TInput;
  artifactKey: string;
  agents: PipeAgentConfig[];
  synthesizer: Agent;
  outputSchema: TOutput;
}

export function createPipeWorkflow<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  options: PipeOptions<TInput, TOutput>,
) {
  const { workflowId, inputSchema, artifactKey, agents, synthesizer, outputSchema } = options;

  if (agents.length === 0) {
    throw new Error('Pipe requires at least one agent');
  }

  const initStep = createStep({
    id: 'init',
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: ThreadSchema,
    execute: async ({ inputData }) => {
      const init = inputData as Record<string, unknown>;
      const artifact = String(init[artifactKey] ?? '');
      return { artifact, thread: '' };
    },
  });

  let workflow = createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  }).then(initStep);

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i]!;
    const step = createStep({
      id: agent.id,
      inputSchema: ThreadSchema,
      outputSchema: ThreadSchema,
      execute: async ({ inputData }) => {
        const { artifact, thread } = inputData as { artifact: string; thread: string };
        const priorOutput = thread || '(First agent — no prior output)';
        const prompt = agent.promptTemplate
          .replace('{artifact}', artifact)
          .replace('{priorOutput}', priorOutput);
        const res = await agent.agent.generate([{ role: 'user', content: prompt }]);
        const newBlock = `## ${agent.id}\n${res.text}`;
        const newThread = thread ? `${thread}\n\n---\n\n${newBlock}` : newBlock;
        return { artifact, thread: newThread };
      },
    });
    workflow = workflow.then(step);
  }

  const synthStep = createStep({
    id: 'synthesizer',
    inputSchema: ThreadSchema,
    outputSchema: outputSchema as z.ZodTypeAny,
    execute: async ({ inputData }) => {
      const { artifact, thread } = inputData as { artifact: string; thread: string };
      const res = await synthesizer.generate(
        [
          {
            role: 'user',
            content: `Original artifact:\n\n${artifact}\n\n---\n\nCommittee thread:\n\n${thread}\n\n---\n\nSynthesize into the required output format.`,
          },
        ],
        { structuredOutput: { schema: outputSchema } },
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- Mastra structuredOutput; schema validated at runtime
      return res.object;
    },
  });

  return workflow.then(synthStep).commit();
}

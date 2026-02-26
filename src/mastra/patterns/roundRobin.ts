/**
 * Round Robin pattern.
 *
 * N agents review in turn; each sees the growing thread of prior agents' responses.
 * Supports multiple rounds. Optional synthesizer merges the thread into structured output;
 * without it, the raw thread is returned. Use for committee-style discussion where each
 * agent responds to prior comments.
 *
 * Each agent's prompt is automatically augmented with:
 *   - Round number (e.g. "Round 1 of 2")
 *   - Team roster with descriptions (so agents know who their teammates are)
 *
 * ```
 * Input ── AgentA ── AgentB(sees A) ── AgentC(sees A+B) ── [round 2...] ── Synthesizer ── Output
 * ```
 *
 * NOTE:
 * - If you want replies driven by @mentions, use `roundRobinWithReplies` instead.
 * - Compared to `pipe`, in `roundRobin` the entire round can repeat multiple times,
 *   and the output format is fixed (a growing thread). In `pipe`, each agent controls
 *   what it returns.
 *
 * @example
 * const workflow = createRoundRobinWorkflow({
 *   workflowId: "round-robin",
 *   inputSchema: z.object({ document: z.string() }),
 *   artifactKey: "document",
 *   agents: [
 *     {
 *       id: "architect",
 *       description: "Reviews technical design and system architecture",
 *       agent: archAgent,
 *       promptTemplate: "Artifact: {artifact}\nThread: {thread}\nRespond.",
 *     },
 *     {
 *       id: "pm",
 *       description: "Owns scope, timeline, and stakeholder alignment",
 *       agent: pmAgent,
 *       promptTemplate: "Artifact: {artifact}\nThread: {thread}\nRespond.",
 *     },
 *   ],
 *   rounds: 2,
 *   synthesizer: synthAgent,
 *   outputSchema: z.object({ consensus: z.string() }),
 *   synthesizerPromptTemplate: "Artifact:\n{artifact}\n\nDiscussion:\n{thread}\n\nSynthesize consensus.",
 * });
 *
 * See docs/features/ai-crews/patterns.md#4-round-robin
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export interface RoundRobinAgentConfig {
  id: string;
  /** Shown to all agents in the team roster so each knows their teammates' roles. */
  description: string;
  agent: Agent;
  /**
   * Prompt template for this agent. Supports {artifact} and {thread} placeholders.
   * Round context (round number, team roster) is injected automatically — do not
   * include it here.
   */
  promptTemplate: string;
}

export interface RoundRobinOptions<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  workflowId: string;
  inputSchema: TInput;
  artifactKey: string;
  agents: RoundRobinAgentConfig[];
  rounds?: number;
  synthesizer?: Agent;
  /** When synthesizer is omitted, pass z.object({ thread: z.string() }) so passthrough output matches. */
  outputSchema: TOutput;
  synthesizerPromptTemplate?: string;
}

const ThreadStateSchema = z.object({ artifact: z.string(), thread: z.string(), round: z.number() });

function buildTeamRoster(agents: RoundRobinAgentConfig[]): string {
  return agents.map((a) => `- @${a.id} — ${a.description}`).join('\n');
}

export function createRoundRobinWorkflow<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  options: RoundRobinOptions<TInput, TOutput>,
) {
  const {
    workflowId,
    inputSchema,
    artifactKey,
    agents,
    rounds = 1,
    synthesizer,
    outputSchema,
    synthesizerPromptTemplate,
  } = options;

  if (agents.length === 0) {
    throw new Error('RoundRobin requires at least one agent');
  }

  if (synthesizer && !synthesizerPromptTemplate) {
    throw new Error(
      'RoundRobin: synthesizerPromptTemplate is required when synthesizer is provided',
    );
  }
  if (!synthesizer && synthesizerPromptTemplate) {
    throw new Error(
      'RoundRobin: synthesizer is required when synthesizerPromptTemplate is provided',
    );
  }

  const teamRoster = buildTeamRoster(agents);

  const initStep = createStep({
    id: 'init',
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: ThreadStateSchema,
    execute: async ({ inputData }) => {
      const init = inputData as Record<string, unknown>;
      const artifact = String(init[artifactKey] ?? '');
      return { artifact, thread: '', round: 0 };
    },
  });

  let workflow = createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  }).then(initStep);

  for (let r = 0; r < rounds; r++) {
    for (const agent of agents) {
      const roundLabel = r + 1;
      const step = createStep({
        id: `${agent.id}-r${r}`,
        inputSchema: ThreadStateSchema,
        outputSchema: ThreadStateSchema,
        execute: async ({ inputData }) => {
          const { artifact, thread, round } = inputData as {
            artifact: string;
            thread: string;
            round: number;
          };

          const preamble = [`[Round ${roundLabel} of ${rounds}]`, `Team:\n${teamRoster}`].join(
            '\n\n',
          );

          const body = agent.promptTemplate
            .replace('{artifact}', artifact)
            .replace('{thread}', thread || '(No prior discussion)');

          const prompt = `${preamble}\n\n---\n\n${body}`;
          const res = await agent.agent.generate([{ role: 'user', content: prompt }]);
          const newBlock = `## ${agent.id} (round ${round + 1})\n${res.text}`;
          const newThread = thread ? `${thread}\n\n---\n\n${newBlock}` : newBlock;
          return { artifact, thread: newThread, round };
        },
      });
      workflow = workflow.then(step);
    }
    if (r < rounds - 1) {
      workflow = workflow.map(async ({ inputData }) => {
        const d = inputData as { artifact: string; thread: string; round: number };
        return { ...d, round: d.round + 1 };
      });
    }
  }

  if (synthesizer && synthesizerPromptTemplate) {
    const synthStep = createStep({
      id: 'synthesizer',
      inputSchema: ThreadStateSchema,
      outputSchema: outputSchema as z.ZodTypeAny,
      execute: async ({ inputData }) => {
        const { artifact, thread } = inputData as { artifact: string; thread: string };
        const prompt = synthesizerPromptTemplate
          .replace('{artifact}', artifact)
          .replace('{thread}', thread);
        const res = await synthesizer.generate([{ role: 'user', content: prompt }], {
          structuredOutput: { schema: outputSchema },
        });
        return res.object;
      },
    });
    return workflow.then(synthStep).commit();
  }

  const passthrough = createStep({
    id: 'passthrough',
    inputSchema: ThreadStateSchema,
    outputSchema: z.object({ thread: z.string() }),
    execute: async ({ inputData }) => {
      const { thread } = inputData as { thread: string };
      return { thread };
    },
  });
  return workflow.then(passthrough).commit();
}

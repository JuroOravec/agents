/**
 * Sidecar (Agent-as-a-Tool) pattern.
 *
 * Wraps an executor agent as a Mastra tool. A "thinker" agent calls this tool with a
 * directive; the executor runs and returns a summary. The thinker never holds
 * dangerous tools directly—only the sidecar can perform sensitive actions. Use for
 * read-file, search, or other execution agents that a planner orchestrates.
 *
 * ```
 * Thinker Agent ── tool(directive) ── Executor Agent (sidecar) ── return summary
 * ```
 *
 * @example
 * const sidecarTool = createSidecarTool({
 *   id: "researcher",
 *   description: "Research a topic and return a summary",
 *   executorAgent: researcherAgent,
 *   executorPromptTemplate: "Research and summarize: {directive}",
 * });
 * // Add sidecarTool to thinker agent's tools; thinker calls it with { directive: "..." }
 *
 * See docs/features/ai-crews/patterns.md#13-sidecar-agent-as-a-tool
 * See docs/features/ai-crews/crew_ai.md for full documentation.
 */

import type { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export interface SidecarToolConfig {
  id: string;
  description: string;
  executorAgent: Agent;
  executorPromptTemplate: string;
}

/**
 * Creates a Mastra tool that wraps an executor agent. The thinker calls this tool with a directive;
 * the executor agent runs and returns a summary.
 */
export function createSidecarTool(config: SidecarToolConfig) {
  const { id, description, executorAgent, executorPromptTemplate } = config;

  return createTool({
    id,
    description,
    inputSchema: z.object({
      directive: z.string().describe('What the sidecar should do (e.g. read file X, search for Y)'),
    }),
    execute: async ({ directive }) => {
      const prompt = executorPromptTemplate.replace('{directive}', directive);
      const res = await executorAgent.generate([{ role: 'user', content: prompt }]);
      return res.text;
    },
  });
}

/**
 * Round Robin With Replies (Mention-Driven) pattern.
 *
 * Alternates between full rounds (all agents) and reply rounds (only @mentioned
 * agents). After each full round, any new @mentions trigger a reply round. After
 * each reply round, any further @mentions trigger another reply round; once
 * no new mentions, a new full round starts. Stops when a full round produces no
 * new @mentions, or maxRounds is reached.
 *
 * Each agent's prompt is automatically augmented with:
 *   - Round number and type (Full Review / Reply Round)
 *   - Team roster with descriptions (so agents know when to @mention whom)
 *   - @mention instructions (full rounds only)
 *   - "You were mentioned" notice (reply rounds only)
 *
 * ```
 * Full Round:   Input ── AgentA ── AgentB ── AgentC ── MentionParser
 *                                                            │ mentions?
 *                                                    yes ←──┘
 * Reply Round:  only @mentioned agents ── MentionParser
 *                          │ new mentions?   │ none
 *                 yes ─────┘                 ↓
 *                                       Full Round ──► (quiesced?) ── Synthesizer ── Output
 * ```
 *
 * @example
 * const workflow = createRoundRobinWithRepliesWorkflow({
 *   workflowId: "design-review",
 *   inputSchema: z.object({ proposal: z.string() }),
 *   artifactKey: "proposal",
 *   agents: [
 *     {
 *       id: "architect",
 *       description: "Reviews technical design and system architecture",
 *       agent: archAgent,
 *       promptTemplate: "Review the following proposal:\n\n{artifact}\n\nDiscussion so far:\n{thread}",
 *     },
 *     {
 *       id: "pm",
 *       description: "Owns scope, timeline, and stakeholder alignment",
 *       agent: pmAgent,
 *       promptTemplate: "Review the following proposal:\n\n{artifact}\n\nDiscussion so far:\n{thread}",
 *     },
 *     {
 *       id: "security",
 *       description: "Flags security risks and compliance concerns",
 *       agent: secAgent,
 *       promptTemplate: "Review the following proposal:\n\n{artifact}\n\nDiscussion so far:\n{thread}",
 *     },
 *   ],
 *   maxRounds: 6,
 *   synthesizer: synthAgent,
 *   outputSchema: z.object({ verdict: z.string() }),
 *   synthesizerPromptTemplate: "Proposal:\n{artifact}\n\nFull discussion:\n{thread}\n\nSynthesize the key findings and decision.",
 * });
 *
 * See docs/features/ai-crews/patterns.md#5-round-robin-with-replies-mention-driven
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export interface RoundRobinWithRepliesAgentConfig {
  id: string;
  /** Shown to all agents in the team roster so they know when to @mention this agent. */
  description: string;
  agent: Agent;
  /**
   * Prompt template for this agent. Supports {artifact} and {thread} placeholders.
   * Round context (round number, type, team roster, mention instructions) is
   * injected automatically — do not include it here.
   */
  promptTemplate: string;
}

/** Extract @mentions from text. Returns unique agent ids found (e.g. "@architect" → "architect"). Uses word boundary to avoid partial matches. */
export function extractMentions(text: string, agentIds: string[]): string[] {
  const mentioned = new Set<string>();
  for (const id of agentIds) {
    if (new RegExp(`@${escapeRegex(id)}\\b`, 'i').test(text)) {
      mentioned.add(id);
    }
  }
  return Array.from(mentioned);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface RoundRobinWithRepliesOptions<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
> {
  workflowId: string;
  inputSchema: TInput;
  /** Key in the workflow input that holds the artifact string to review. */
  artifactKey: string;
  agents: RoundRobinWithRepliesAgentConfig[];
  /**
   * Hard ceiling on total rounds (full + reply combined). Defaults to 8.
   * The loop also stops naturally when a full round produces no new @mentions.
   */
  maxRounds?: number;
  synthesizer: Agent;
  outputSchema: TOutput;
  synthesizerPromptTemplate: string;
}

const LoopStateSchema = z.object({
  artifact: z.string(),
  thread: z.string(),
  roundCount: z.number(),
  lastRoundType: z.enum(['full', 'reply']),
  /** Agents to address in the next reply round. Empty → run a full round next. */
  pendingMentionIds: z.array(z.string()),
});

function buildTeamRoster(agents: RoundRobinWithRepliesAgentConfig[]): string {
  return agents.map((a) => `- @${a.id} — ${a.description}`).join('\n');
}

export function createRoundRobinWithRepliesWorkflow<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(options: RoundRobinWithRepliesOptions<TInput, TOutput>) {
  const {
    workflowId,
    inputSchema,
    artifactKey,
    agents,
    maxRounds = 8,
    synthesizer,
    outputSchema,
    synthesizerPromptTemplate,
  } = options;

  if (agents.length === 0) {
    throw new Error('RoundRobinWithReplies requires at least one agent');
  }

  const agentIds = agents.map((a) => a.id);
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const teamRoster = buildTeamRoster(agents);
  const mentionInstructions = `To request a specific colleague's input, @mention them by their exact id (e.g. ${agentIds.map((id) => `@${id}`).join(', ')}). Mentioned agents will get a dedicated reply round before the next full review.`;

  const initStep = createStep({
    id: 'init',
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: LoopStateSchema,
    execute: async ({ inputData }) => {
      const init = inputData as Record<string, unknown>;
      return {
        artifact: String(init[artifactKey] ?? ''),
        thread: '',
        roundCount: 0,
        // Starting as 'reply' with no pendingMentions triggers the first full round.
        lastRoundType: 'reply' as const,
        pendingMentionIds: [],
      };
    },
  });

  const roundStep = createStep({
    id: 'round',
    inputSchema: LoopStateSchema,
    outputSchema: LoopStateSchema,
    execute: async ({ inputData }) => {
      const state = inputData as z.infer<typeof LoopStateSchema>;
      const { artifact, pendingMentionIds } = state;
      const isReplyRound = pendingMentionIds.length > 0;
      const roundLabel = state.roundCount + 1;

      const activeAgents: RoundRobinWithRepliesAgentConfig[] = isReplyRound
        ? (pendingMentionIds
            .map((id) => agentById.get(id))
            .filter(Boolean) as RoundRobinWithRepliesAgentConfig[])
        : agents;

      const threadBefore = state.thread;
      let thread = state.thread;

      for (const agentConfig of activeAgents) {
        const preamble = isReplyRound
          ? [
              `[Round ${roundLabel} · Reply Round]`,
              `Team:\n${teamRoster}`,
              `You have been @mentioned in the discussion. Respond to the points directed at you, then add your own analysis if needed.`,
              mentionInstructions,
            ].join('\n\n')
          : [
              `[Round ${roundLabel} · Full Review]`,
              `Team:\n${teamRoster}`,
              mentionInstructions,
            ].join('\n\n');

        const body = agentConfig.promptTemplate
          .replace('{artifact}', artifact)
          .replace('{thread}', thread || '(No prior discussion)');

        const prompt = `${preamble}\n\n---\n\n${body}`;
        const res = await agentConfig.agent.generate([{ role: 'user', content: prompt }]);

        const label = isReplyRound
          ? `${agentConfig.id} (reply, round ${roundLabel})`
          : `${agentConfig.id} (round ${roundLabel})`;
        const block = `## ${label}\n${res.text}`;
        thread = thread ? `${thread}\n\n---\n\n${block}` : block;
      }

      // Extract mentions only from new additions; exclude agents who just spoke
      // this round to prevent immediate back-and-forth loops.
      const newAdditions = thread.slice(threadBefore.length);
      const newMentions = extractMentions(newAdditions, agentIds).filter(
        (id) => !activeAgents.some((a) => a.id === id),
      );

      return {
        artifact,
        thread,
        roundCount: roundLabel,
        lastRoundType: isReplyRound ? ('reply' as const) : ('full' as const),
        pendingMentionIds: newMentions,
      };
    },
  });

  const SynthInputSchema = z.object({ artifact: z.string(), thread: z.string() });

  const prepSynthStep = createStep({
    id: 'prepare-synthesizer',
    inputSchema: LoopStateSchema,
    outputSchema: SynthInputSchema,
    execute: async ({ inputData }) => {
      const { artifact, thread } = inputData as z.infer<typeof LoopStateSchema>;
      return { artifact, thread };
    },
  });

  const synthStep = createStep({
    id: 'synthesizer',
    inputSchema: SynthInputSchema,
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

  return createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    .then(initStep)
    .dowhile(roundStep, async ({ inputData, iterationCount }) => {
      const state = inputData as z.infer<typeof LoopStateSchema>;
      if (iterationCount >= maxRounds) return false;
      // Stop when a full round quiesces (no new mentions produced).
      if (state.lastRoundType === 'full' && state.pendingMentionIds.length === 0) return false;
      return true;
    })
    .then(prepSynthStep)
    .then(synthStep)
    .commit();
}

/**
 * Compete Tournament Bracket pattern.
 *
 * Runs a single bracket round: pairs candidates from an array, runs a judge agent on
 * each pair to pick a winner, returns all winners and round results. For a full
 * tournament (elimination until one remains), run this workflow repeatedly or wrap
 * in an external loop. Use for ranking, A/B-style selection, or competitive filtering.
 *
 * One of several possible "competition" layouts to arrive at "best N"—this is the
 * classic pairwise bracket elimination style.
 *
 * ```
 * Candidates ── pair(A,B) ── foreach(Judge per pair) ── reduce(winners) ── Output
 * ```
 *
 * @example
 * const workflow = createCompeteTournamentBracketWorkflow({
 *   workflowId: "bracket-round",
 *   inputSchema: z.object({ candidates: z.array(z.string()) }),
 *   candidatesKey: "candidates",
 *   judge: judgeAgent,
 *   judgePromptTemplate: "Pick the better option. A: {a}\nB: {b}\n\nReturn the FULL TEXT of the winning option as { winner: string, reason?: string }. E.g. if A wins, winner must be the exact A content.",
 *   outputSchema: z.object({ winners: z.array(z.string()), roundResults: z.array(z.any()) }),
 * });
 *
 * See docs/features/ai-crews/patterns.md#12-compete-tournament-bracket
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export interface CompeteTournamentBracketOptions<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
> {
  workflowId: string;
  inputSchema: TInput;
  /** Key for array of initial candidates */
  candidatesKey: string;
  judge: Agent;
  judgePromptTemplate: string;
  outputSchema: TOutput;
}

const PairSchema = z.object({ a: z.string(), b: z.string() });
const WinnerSchema = z.object({ winner: z.string(), reason: z.string().optional() });

/**
 * Runs a single bracket round: pair items, judge each pair, return winners.
 * For full tournament, wrap in a loop or run multiple rounds externally.
 */
export function createCompeteTournamentBracketWorkflow<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(options: CompeteTournamentBracketOptions<TInput, TOutput>) {
  const { workflowId, inputSchema, candidatesKey, judge, judgePromptTemplate, outputSchema } =
    options;

  const pairStep = createStep({
    id: 'pair',
    inputSchema: z.array(z.string()),
    outputSchema: z.array(PairSchema),
    execute: async ({ inputData }) => {
      const items = inputData as string[];
      const pairs: { a: string; b: string }[] = [];
      for (let i = 0; i < items.length - 1; i += 2) {
        pairs.push({ a: items[i]!, b: items[i + 1] ?? items[i]! });
      }
      if (items.length % 2 === 1) {
        pairs.push({ a: items[items.length - 1]!, b: items[items.length - 1]! });
      }
      return pairs;
    },
  });

  const judgePairStep = createStep({
    id: 'judge-pair',
    inputSchema: PairSchema,
    outputSchema: WinnerSchema,
    execute: async ({ inputData }) => {
      const { a, b } = inputData as { a: string; b: string };
      const prompt = judgePromptTemplate.replace('{a}', a).replace('{b}', b);
      const res = await judge.generate([{ role: 'user', content: prompt }], {
        structuredOutput: { schema: WinnerSchema },
      });
      return res.object as z.infer<typeof WinnerSchema>;
    },
  });

  const reduceStep = createStep({
    id: 'reduce',
    inputSchema: z.array(WinnerSchema),
    outputSchema: outputSchema as z.ZodTypeAny,
    execute: async ({ inputData }) => {
      const winners = inputData as z.infer<typeof WinnerSchema>[];
      const winnerIds = winners.map((w) => w.winner);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- Mastra outputSchema as ZodTypeAny for workflow API
      return { winners: winnerIds, roundResults: winners } as z.infer<typeof outputSchema>;
    },
  });

  const initStep = createStep({
    id: 'init',
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.array(z.string()),
    execute: async ({ inputData }) => {
      const init = inputData as Record<string, unknown>;
      const arr = init[candidatesKey];
      if (!Array.isArray(arr)) {
        throw new Error(
          `CompeteTournamentBracket: input[${candidatesKey}] must be an array, got ${typeof arr}`,
        );
      }
      if (arr.length === 0) {
        throw new Error(
          `CompeteTournamentBracket: input[${candidatesKey}] must be a non-empty array`,
        );
      }
      return arr as string[];
    },
  });

  return createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    .then(initStep)
    .then(pairStep)
    .foreach(judgePairStep, { concurrency: 4 })
    .then(reduceStep)
    .commit();
}

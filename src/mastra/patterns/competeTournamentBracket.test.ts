/**
 * Tests for the Compete Tournament Bracket pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createCompeteTournamentBracketWorkflow } from './competeTournamentBracket.js';

const InputSchema = z.object({ candidates: z.array(z.string()) });
const OutputSchema = z.object({
  winners: z.array(z.string()),
  roundResults: z.array(z.any()),
});

vi.mock('@mastra/core/agent', () => ({
  Agent: vi.fn().mockImplementation(() => ({
    generate: vi
      .fn()
      .mockImplementation(
        (_messages: unknown[], options?: { structuredOutput?: { schema: z.ZodType } }) => {
          const schema = options?.structuredOutput?.schema as
            | z.ZodObject<Record<string, z.ZodType>>
            | undefined;
          const shape = schema?.shape ?? {};
          if ('winner' in shape) {
            return Promise.resolve({
              text: '',
              object: { winner: 'Option A', reason: 'Better choice' },
            });
          }
          return Promise.resolve({ text: '', object: {} });
        },
      ),
  })),
}));

describe('createCompeteTournamentBracketWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pairs candidates, judges each pair, and returns winners', async () => {
    const judge = new Agent({ id: 'judge' });

    const workflow = createCompeteTournamentBracketWorkflow({
      workflowId: 'bracket-round',
      inputSchema: InputSchema,
      candidatesKey: 'candidates',
      judge,
      judgePromptTemplate: 'Pick better: A: {a} B: {b}',
      outputSchema: OutputSchema,
    });

    const run = await workflow.createRun();
    const result = await run.start({
      inputData: { candidates: ['Option A', 'Option B', 'Option C', 'Option D'] },
    });

    expect(result.status).toBe('success');
    const output = (result as { result?: { winners?: string[]; roundResults?: unknown[] } }).result;
    expect(output?.winners).toHaveLength(2);
    expect(output?.roundResults).toHaveLength(2);
  });

  it('handles odd number of candidates with bye', async () => {
    const judge = new Agent({ id: 'judge' });

    vi.mocked(Agent).mockImplementation(() => ({
      generate: vi
        .fn()
        .mockResolvedValueOnce({ text: '', object: { winner: 'A', reason: '' } })
        .mockResolvedValueOnce({ text: '', object: { winner: 'C', reason: '' } }),
    }));

    const workflow = createCompeteTournamentBracketWorkflow({
      workflowId: 'bracket-round',
      inputSchema: InputSchema,
      candidatesKey: 'candidates',
      judge,
      judgePromptTemplate: 'Pick: {a} vs {b}',
      outputSchema: OutputSchema,
    });

    const run = await workflow.createRun();
    const result = await run.start({
      inputData: { candidates: ['A', 'B', 'C'] },
    });

    expect(result.status).toBe('success');
    const output = (result as { result?: { winners?: string[] } }).result;
    expect(output?.winners).toHaveLength(2);
  });

  it('throws when candidates is not an array', async () => {
    const judge = new Agent({ id: 'judge' });
    const workflow = createCompeteTournamentBracketWorkflow({
      workflowId: 'bracket',
      inputSchema: InputSchema,
      candidatesKey: 'candidates',
      judge,
      judgePromptTemplate: '{a} vs {b}',
      outputSchema: OutputSchema,
    });

    const run = await workflow.createRun();
    await expect(run.start({ inputData: { candidates: 'not-array' } })).rejects.toThrow(
      /Expected array|must be an array/,
    );
  });

  it('fails when candidates is empty', async () => {
    const judge = new Agent({ id: 'judge' });
    const workflow = createCompeteTournamentBracketWorkflow({
      workflowId: 'bracket',
      inputSchema: InputSchema,
      candidatesKey: 'candidates',
      judge,
      judgePromptTemplate: '{a} vs {b}',
      outputSchema: OutputSchema,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { candidates: [] } });

    expect(result.status).toBe('failed');
    expect((result as { error?: { message?: string } }).error?.message).toMatch(/non-empty/);
  });
});

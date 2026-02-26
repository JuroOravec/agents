/**
 * Tests for the Map-Then-Reduce (Batch Processing) pattern.
 */

import { Agent } from '@mastra/core/agent';
import { createStep } from '@mastra/core/workflows';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createMapThenReduceWorkflow } from './mapThenReduce.js';

const InputSchema = z.object({ articles: z.array(z.string()) });
const OutputSchema = z.object({ summaries: z.array(z.string()) });

vi.mock('@mastra/core/agent', () => ({
  Agent: vi.fn().mockImplementation((opts?: { id?: string }) => ({
    generate: vi.fn().mockImplementation((messages: { role: string; content: string }[]) => {
      const content = messages[0]?.content ?? '';
      const itemMatch = content.match(/"([^"]+)"/);
      const item = itemMatch ? itemMatch[1] : 'unknown';
      return Promise.resolve({
        text: `Summary of ${item}`,
        object: undefined,
      });
    }),
  })),
}));

describe('createMapThenReduceWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('processes each item and aggregates results', async () => {
    const agent = new Agent({ id: 'summarizer' });
    const aggregateStep = createStep({
      id: 'aggregate',
      inputSchema: z.array(z.object({ result: z.string(), item: z.any() })),
      outputSchema: OutputSchema,
      execute: async ({ inputData }) => ({
        summaries: (inputData as { result: string }[]).map((r) => r.result),
      }),
    });

    const workflow = createMapThenReduceWorkflow({
      workflowId: 'batch-summarize',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      itemsKey: 'articles',
      agent,
      itemPromptTemplate: 'Summarize: {item}',
      aggregateStep,
      concurrency: 2,
    });

    const run = await workflow.createRun();
    const result = await run.start({
      inputData: { articles: ['Article A', 'Article B'] },
    });

    expect(result.status).toBe('success');
    const output = (result as { result?: { summaries?: string[] } }).result;
    expect(output?.summaries).toEqual(['Summary of Article A', 'Summary of Article B']);
  });

  it('throws when itemsKey is not an array', async () => {
    const agent = new Agent({ id: 'summarizer' });
    const aggregateStep = createStep({
      id: 'aggregate',
      inputSchema: z.array(z.any()),
      outputSchema: OutputSchema,
      execute: async ({ inputData }) => ({ summaries: [] }),
    });

    const workflow = createMapThenReduceWorkflow({
      workflowId: 'batch-summarize',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      itemsKey: 'articles',
      agent,
      itemPromptTemplate: 'Summarize: {item}',
      aggregateStep,
    });

    const run = await workflow.createRun();
    await expect(run.start({ inputData: { articles: 'not-an-array' } })).rejects.toThrow(
      /Expected array|must be an array/,
    );
  });
});

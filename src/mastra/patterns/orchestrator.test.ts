/**
 * Tests for the Orchestrator pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createOrchestratorWorkflow } from './orchestrator.js';

const InputSchema = z.object({ task: z.string() });
const OutputSchema = z.object({ result: z.string(), task: z.string() });

vi.mock('@mastra/core/agent', () => ({
  Agent: vi.fn().mockImplementation((opts?: { id?: string }) => {
    const agentId = (opts as { id?: string })?.id ?? 'agent';
    return {
      generate: vi
        .fn()
        .mockImplementation(
          (_messages: unknown[], options?: { structuredOutput?: { schema: z.ZodType } }) => {
            const schema = options?.structuredOutput?.schema as
              | z.ZodObject<Record<string, z.ZodType>>
              | undefined;
            const shape = schema?.shape ?? {};
            if ('nextWorker' in shape) {
              return Promise.resolve({
                text: '',
                object: { nextWorker: null, directive: '', done: true },
              });
            }
            return Promise.resolve({
              text: `Worker ${agentId} output`,
              object: shape?.result ? { result: `from-${agentId}` } : undefined,
            });
          },
        ),
    };
  }),
}));

describe('createOrchestratorWorkflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completes when router signals done immediately', async () => {
    const router = new Agent({ id: 'orchestrator' });
    const worker = new Agent({ id: 'researcher' });

    const workflow = createOrchestratorWorkflow({
      workflowId: 'test-orchestrator',
      inputSchema: InputSchema,
      taskKey: 'task',
      router,
      workers: [{ id: 'researcher', agent: worker, promptTemplate: 'Task: {task}' }],
      outputSchema: OutputSchema,
      maxIterations: 3,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { task: 'Research topic X' } });

    expect(result.status).toBe('success');
    const output = (result as { result?: { result?: string; task?: string } }).result;
    expect(output?.task).toBe('Research topic X');
    expect(output?.result).toBeDefined();
  });
});

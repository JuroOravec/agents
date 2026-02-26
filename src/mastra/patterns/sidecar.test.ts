/**
 * Tests for the Sidecar (Agent-as-a-Tool) pattern.
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSidecarTool } from './sidecar.js';

vi.mock('@mastra/core/agent', () => ({
  Agent: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue({
      text: 'Summary of the research results',
      object: undefined,
    }),
  })),
}));

describe('createSidecarTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a tool that invokes executor agent with directive', async () => {
    const executorAgent = new Agent({ id: 'researcher' });

    const tool = createSidecarTool({
      id: 'researcher',
      description: 'Research a topic and return a summary',
      executorAgent,
      executorPromptTemplate: 'Research and summarize: {directive}',
    });

    expect(tool.id).toBe('researcher');
    expect(tool.description).toContain('Research');

    const result = await tool.execute({ directive: 'Find latest NLP techniques' });

    expect(result).toBe('Summary of the research results');
    expect(executorAgent.generate).toHaveBeenCalledWith([
      { role: 'user', content: 'Research and summarize: Find latest NLP techniques' },
    ]);
  });
});

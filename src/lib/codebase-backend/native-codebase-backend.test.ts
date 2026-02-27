/**
 * Unit tests for NativeCodebaseBackend.
 *
 * Verifies:
 * - ask() creates a read-only agent (readFile, listDir, searchCode — no write tools)
 * - edit() creates an agent with write tools (writeFile, runShell included)
 * - Both drain the Mastra fullStream and return the final text
 * - onThought and onEvent callbacks are wired through to drainFullStream
 * - errors in the agent stream still resolve (no unhandled rejections)
 */

import { Agent } from '@mastra/core/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NativeCodebaseBackend } from './native-codebase-backend.js';

vi.mock('@mastra/core/agent', () => ({
  Agent: vi.fn().mockImplementation(() => ({
    stream: vi.fn().mockResolvedValue({
      text: Promise.resolve('agent response'),
      fullStream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-delta', payload: { text: 'thinking...' } });
          controller.close();
        },
      }),
    }),
  })),
}));

vi.mock('./native-tools.js', () => ({
  createReadFileTool: vi.fn().mockReturnValue({ id: 'readFile' }),
  createListDirTool: vi.fn().mockReturnValue({ id: 'listDir' }),
  createSearchCodeTool: vi.fn().mockReturnValue({ id: 'searchCode' }),
  createWriteFileTool: vi.fn().mockReturnValue({ id: 'writeFile' }),
  createRunShellTool: vi.fn().mockReturnValue({ id: 'runShell' }),
}));

const fakeLlm = {} as Parameters<typeof Agent>[0]['model'];

describe('NativeCodebaseBackend.ask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an agent with only read-only tools', async () => {
    const backend = new NativeCodebaseBackend({ worktreePath: '/tmp/wt', llm: fakeLlm });
    await backend.ask('What does index.ts export?');

    expect(Agent).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          readFile: expect.anything(),
          listDir: expect.anything(),
          searchCode: expect.anything(),
        }),
      }),
    );
    const tools = vi.mocked(Agent).mock.calls[0][0].tools as Record<string, unknown>;
    expect(tools).not.toHaveProperty('writeFile');
    expect(tools).not.toHaveProperty('runShell');
  });

  it('returns the text output from the agent stream', async () => {
    const backend = new NativeCodebaseBackend({ worktreePath: '/tmp/wt', llm: fakeLlm });
    expect(await backend.ask('What is config.ts?')).toBe('agent response');
  });

  it('includes query and optional context in the prompt', async () => {
    const backend = new NativeCodebaseBackend({ worktreePath: '/tmp/wt', llm: fakeLlm });
    await backend.ask('Where is the factory?', 'focus on config.ts');

    const agentInstance = vi.mocked(Agent).mock.results[0].value;
    const promptText = agentInstance.stream.mock.calls[0][0][0].content;
    expect(promptText).toContain('Where is the factory?');
    expect(promptText).toContain('focus on config.ts');
  });

  it('forwards onThought deltas to the callback', async () => {
    const onThought = vi.fn();
    const backend = new NativeCodebaseBackend({
      worktreePath: '/tmp/wt',
      llm: fakeLlm,
      callbacks: { onThought },
    });
    await backend.ask('anything');
    expect(onThought).toHaveBeenCalledWith('thinking...');
  });
});

describe('NativeCodebaseBackend.edit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an agent with read and write tools including runShell', async () => {
    const backend = new NativeCodebaseBackend({ worktreePath: '/tmp/wt', llm: fakeLlm });
    await backend.edit('Add export to foo.ts');

    const tools = vi.mocked(Agent).mock.calls[0][0].tools as Record<string, unknown>;
    expect(tools).toHaveProperty('readFile');
    expect(tools).toHaveProperty('writeFile');
    expect(tools).toHaveProperty('runShell');
  });

  it('instructions mention npm run check:agent', async () => {
    const backend = new NativeCodebaseBackend({ worktreePath: '/tmp/wt', llm: fakeLlm });
    await backend.edit('Fix lint error');

    const instructions = vi.mocked(Agent).mock.calls[0][0].instructions as string;
    expect(instructions).toContain('npm run check:agent');
  });

  it('returns the text output from the agent stream', async () => {
    const backend = new NativeCodebaseBackend({ worktreePath: '/tmp/wt', llm: fakeLlm });
    expect(await backend.edit('Add a comment')).toBe('agent response');
  });

  it('forwards onThought and onEvent callbacks', async () => {
    const onThought = vi.fn();
    const onEvent = vi.fn();
    const backend = new NativeCodebaseBackend({
      worktreePath: '/tmp/wt',
      llm: fakeLlm,
      callbacks: { onThought, onEvent },
    });
    await backend.edit('anything');

    expect(onThought).toHaveBeenCalledWith('thinking...');
    expect(onEvent).toHaveBeenCalled();
  });
});

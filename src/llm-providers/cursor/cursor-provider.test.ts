/**
 * Unit tests for CursorCLILanguageModel and parseCursorEventLine (cursor-provider).
 *
 * Tests mock `child_process.spawn` to avoid requiring a real cursor-agent binary.
 * They cover:
 *   - parseCursorEventLine: NDJSON parsing contract
 *   - Stream routing: onChunk receives text deltas, onEvent receives all events
 *   - Full output still resolved after streaming
 *   - Error path still works (non-zero exit code)
 */

import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CursorCLILanguageModel, parseCursorEventLine } from './cursor-provider.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// ─── parseCursorEventLine ──────────────────────────────────────────────────

describe('parseCursorEventLine', () => {
  it('parses a valid assistant event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      session_id: 's1',
    });
    const event = parseCursorEventLine(line);
    expect(event).toMatchObject({ type: 'assistant' });
  });

  it('parses a tool_call started event', () => {
    const line = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      tool_call: { editToolCall: { args: { path: 'src/foo.ts' } } },
      session_id: 's1',
    });
    const event = parseCursorEventLine(line);
    expect(event).toMatchObject({ type: 'tool_call', subtype: 'started' });
  });

  it('parses a result event', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'All done.',
      duration_ms: 1234,
      session_id: 's1',
    });
    const event = parseCursorEventLine(line);
    expect(event).toMatchObject({ type: 'result', result: 'All done.' });
  });

  it('returns null for blank lines', () => {
    expect(parseCursorEventLine('')).toBeNull();
    expect(parseCursorEventLine('   ')).toBeNull();
  });

  it('returns null for non-JSON lines', () => {
    expect(parseCursorEventLine('not json at all')).toBeNull();
  });
});

// ─── CursorCLILanguageModel streaming ─────────────────────────────────────

/** Creates a fake child process that emits stdout lines then closes. */
function makeFakeProc(lines: string[], exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: () => void };
    kill: (signal?: string) => void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: vi.fn() as () => void };
  proc.kill = vi.fn();
  return {
    proc,
    emit: () => {
      for (const line of lines) {
        proc.stdout.emit('data', Buffer.from(line + '\n'));
      }
      proc.emit('close', exitCode);
    },
  };
}

/** Builds a stream-json assistant event line. */
function assistantLine(text: string, sessionId = 's1') {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    session_id: sessionId,
  });
}

/** Builds a stream-json tool_call started event line. */
function toolCallLine(opts: {
  toolKey: string;
  args: Record<string, unknown>;
  sessionId?: string;
}) {
  const { toolKey, args, sessionId = 's1' } = opts;
  return JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    tool_call: { [toolKey]: { args } },
    session_id: sessionId,
  });
}

/** Builds a stream-json result event line. */
function resultLine(result: string, sessionId = 's1') {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    result,
    duration_ms: 100,
    session_id: sessionId,
  });
}

describe('CursorCLILanguageModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves with the result text from the result event', async () => {
    const { proc, emit } = makeFakeProc([
      assistantLine('Thinking...'),
      resultLine('Files changed: src/foo.ts'),
    ]);
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const model = new CursorCLILanguageModel('test-model', { workspace: '/tmp' });
    const resultPromise = model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });

    emit();
    const result = await resultPromise;

    expect(result.content).toEqual([{ type: 'text', text: 'Files changed: src/foo.ts' }]);
  });

  it('calls onChunk with text from assistant events in order', async () => {
    const { proc, emit } = makeFakeProc([
      assistantLine('chunk1'),
      assistantLine('chunk2'),
      resultLine('done'),
    ]);
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const received: string[] = [];
    const model = new CursorCLILanguageModel('test-model', {
      workspace: '/tmp',
      onChunk: (c) => received.push(c),
    });

    const p = model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    emit();
    await p;

    expect(received).toEqual(['chunk1', 'chunk2']);
  });

  it('calls onEvent for every parsed event including tool_call', async () => {
    const { proc, emit } = makeFakeProc([
      assistantLine('Thinking...'),
      toolCallLine({ toolKey: 'editToolCall', args: { path: 'src/foo.ts' } }),
      resultLine('done'),
    ]);
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const events: string[] = [];
    const model = new CursorCLILanguageModel('test-model', {
      workspace: '/tmp',
      onEvent: (e) => events.push(e.type),
    });

    const p = model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    emit();
    await p;

    expect(events).toContain('assistant');
    expect(events).toContain('tool_call');
    expect(events).toContain('result');
  });

  it('rejects when the process exits with a non-zero code', async () => {
    const { proc, emit } = makeFakeProc([], 1);
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const model = new CursorCLILanguageModel('test-model', { workspace: '/tmp' });
    const p = model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    emit();

    await expect(p).rejects.toThrow('cursor-agent exited 1');
  });

  it('uses --output-format stream-json and --stream-partial-output args', async () => {
    const { proc, emit } = makeFakeProc([resultLine('ok')]);
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const model = new CursorCLILanguageModel('test-model', { workspace: '/tmp' });
    const p = model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    emit();
    await p;

    const spawnArgs = vi.mocked(childProcess.spawn).mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('stream-json');
    expect(spawnArgs).toContain('--stream-partial-output');
  });
});

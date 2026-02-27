/**
 * Unit tests for CursorCodebaseBackend (Cursor CLI adapter).
 *
 * Verifies that:
 * - ask()  calls cursorCLI with mode:'ask', never writes files
 * - edit() calls cursorCLI with mode:'agent', injects check:agent into prompt
 * - callbacks (onChunk, onEvent) are forwarded to cursorCLI
 * - errors are caught and returned as strings (not re-thrown)
 * - text is correctly extracted from content arrays
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as cursorProvider from '../../llm-providers/cursor/cursor-provider.js';
import {
  CURSOR_EVENT_PREFIX,
  CURSOR_TOOL_LABELS,
  CursorCodebaseBackend,
  formatCursorEvent,
  makeCursorEventHandler,
} from './cursor-codebase-backend.js';

vi.mock('../../llm-providers/cursor/cursor-provider.js', () => ({
  cursorCLI: vi.fn(),
}));

function makeDoGenerate(text: string) {
  return vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] });
}

describe('CursorCodebaseBackend.ask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls cursorCLI with mode:"ask" for read-only queries', async () => {
    const doGenerate = makeDoGenerate('answer');
    vi.mocked(cursorProvider.cursorCLI).mockReturnValue({ doGenerate } as never);

    const backend = new CursorCodebaseBackend({ worktreePath: '/tmp/wt' });
    await backend.ask('What does index.ts do?');

    expect(cursorProvider.cursorCLI).toHaveBeenCalledWith(
      'composer-1.5',
      expect.objectContaining({ workspace: '/tmp/wt', mode: 'ask' }),
    );
  });

  it('returns the text from the content array', async () => {
    vi.mocked(cursorProvider.cursorCLI).mockReturnValue({
      doGenerate: makeDoGenerate('It exports a helper.'),
    } as never);

    const backend = new CursorCodebaseBackend({ worktreePath: '/tmp/wt' });
    expect(await backend.ask('What does index.ts export?')).toBe('It exports a helper.');
  });

  it('includes the query and optional context in the prompt', async () => {
    const doGenerate = makeDoGenerate('ok');
    vi.mocked(cursorProvider.cursorCLI).mockReturnValue({ doGenerate } as never);

    const backend = new CursorCodebaseBackend({ worktreePath: '/tmp/wt' });
    await backend.ask('Where is the config?', 'Looking for CREW_MODEL env vars');

    const callArgs = doGenerate.mock.calls[0][0] as {
      prompt: Array<{ content: Array<{ text: string }> }>;
    };
    const promptText = callArgs.prompt[0].content[0].text;
    expect(promptText).toContain('Where is the config?');
    expect(promptText).toContain('Looking for CREW_MODEL env vars');
  });

  it('catches errors and returns the error message string', async () => {
    vi.mocked(cursorProvider.cursorCLI).mockReturnValue({
      doGenerate: vi.fn().mockRejectedValue(new Error('CLI unavailable')),
    } as never);

    expect(await new CursorCodebaseBackend({ worktreePath: '/tmp/wt' }).ask('any')).toBe(
      'CLI unavailable',
    );
  });

  it('forwards onChunk and onCursorEvent callbacks to cursorCLI', async () => {
    vi.mocked(cursorProvider.cursorCLI).mockReturnValue({
      doGenerate: makeDoGenerate('ok'),
    } as never);

    const onChunk = vi.fn();
    const onCursorEvent = vi.fn();
    await new CursorCodebaseBackend({
      worktreePath: '/tmp/wt',
      callbacks: { onChunk, onCursorEvent },
    }).ask('query');

    expect(cursorProvider.cursorCLI).toHaveBeenCalledWith(
      'composer-1.5',
      expect.objectContaining({ onChunk, onEvent: onCursorEvent }),
    );
  });
});

describe('CursorCodebaseBackend.edit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls cursorCLI with mode:"agent" for writes', async () => {
    vi.mocked(cursorProvider.cursorCLI).mockReturnValue({
      doGenerate: makeDoGenerate('done'),
    } as never);

    await new CursorCodebaseBackend({ worktreePath: '/tmp/wt' }).edit('Add a comment to foo.ts');

    expect(cursorProvider.cursorCLI).toHaveBeenCalledWith(
      'composer-1.5',
      expect.objectContaining({ workspace: '/tmp/wt', mode: 'agent' }),
    );
  });

  it('injects npm run check:agent into the prompt', async () => {
    const doGenerate = makeDoGenerate('done');
    vi.mocked(cursorProvider.cursorCLI).mockReturnValue({ doGenerate } as never);

    await new CursorCodebaseBackend({ worktreePath: '/tmp/wt' }).edit('Add export to bar.ts');

    const callArgs = doGenerate.mock.calls[0][0] as {
      prompt: Array<{ content: Array<{ text: string }> }>;
    };
    const promptText = callArgs.prompt[0].content[0].text;
    expect(promptText).toContain('npm run check:agent');
    expect(promptText).toContain('Add export to bar.ts');
  });

  it('includes optional context in the prompt', async () => {
    const doGenerate = makeDoGenerate('done');
    vi.mocked(cursorProvider.cursorCLI).mockReturnValue({ doGenerate } as never);

    await new CursorCodebaseBackend({ worktreePath: '/tmp/wt' }).edit(
      'Fix lint',
      'only touch src/index.ts',
    );

    const callArgs = doGenerate.mock.calls[0][0] as {
      prompt: Array<{ content: Array<{ text: string }> }>;
    };
    expect(callArgs.prompt[0].content[0].text).toContain('only touch src/index.ts');
  });

  it('catches errors and returns the error message string', async () => {
    vi.mocked(cursorProvider.cursorCLI).mockReturnValue({
      doGenerate: vi.fn().mockRejectedValue(new Error('Permission denied')),
    } as never);

    expect(await new CursorCodebaseBackend({ worktreePath: '/tmp/wt' }).edit('any')).toBe(
      'Permission denied',
    );
  });

  it('forwards onChunk and onCursorEvent callbacks to cursorCLI', async () => {
    vi.mocked(cursorProvider.cursorCLI).mockReturnValue({
      doGenerate: makeDoGenerate('ok'),
    } as never);

    const onChunk = vi.fn();
    const onCursorEvent = vi.fn();
    await new CursorCodebaseBackend({
      worktreePath: '/tmp/wt',
      callbacks: { onChunk, onCursorEvent },
    }).edit('directive');

    expect(cursorProvider.cursorCLI).toHaveBeenCalledWith(
      'composer-1.5',
      expect.objectContaining({ onChunk, onEvent: onCursorEvent }),
    );
  });
});

describe('formatCursorEvent', () => {
  it('returns null for non-tool_call events', () => {
    expect(formatCursorEvent({ type: 'assistant', text: 'hi' } as never)).toBeNull();
  });

  it('formats started tool_call with path arg', () => {
    const event = {
      type: 'tool_call',
      subtype: 'started',
      tool_call: { editToolCall: { args: { path: 'src/foo.ts' } } },
    };
    const result = formatCursorEvent(event as never);
    expect(result).toEqual({ line: '    ↳ [cursor] edit src/foo.ts', isFailure: false });
  });

  it('uses CURSOR_TOOL_LABELS for known tools', () => {
    expect(CURSOR_TOOL_LABELS['editToolCall']).toBe('edit');
    expect(CURSOR_TOOL_LABELS['shellToolCall']).toBe('shell');
  });

  it('uses CURSOR_EVENT_PREFIX in output', () => {
    expect(CURSOR_EVENT_PREFIX).toBe('↳ [cursor] ');
  });

  it('returns failure line for completed tool_call with success=false', () => {
    const event = {
      type: 'tool_call',
      subtype: 'completed',
      tool_call: { shellToolCall: { result: { success: false } } },
    };
    const result = formatCursorEvent(event as never);
    expect(result).toEqual({ line: '    ✗ [cursor] shell failed', isFailure: true });
  });

  it('returns null for completed tool_call with success', () => {
    const event = {
      type: 'tool_call',
      subtype: 'completed',
      tool_call: { editToolCall: { result: { success: true } } },
    };
    expect(formatCursorEvent(event as never)).toBeNull();
  });
});

describe('makeCursorEventHandler', () => {
  it('calls flush and log when formatCursorEvent returns a result', () => {
    const flush = vi.fn();
    const log = vi.fn();
    const handler = makeCursorEventHandler(flush, log);
    handler({
      type: 'tool_call',
      subtype: 'started',
      tool_call: { editToolCall: { args: { path: 'x.ts' } } },
    } as never);
    expect(flush).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('    ↳ [cursor] edit x.ts', false);
  });

  it('does not call flush or log when formatCursorEvent returns null', () => {
    const flush = vi.fn();
    const log = vi.fn();
    const handler = makeCursorEventHandler(flush, log);
    handler({ type: 'assistant', text: 'ok' } as never);
    expect(flush).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

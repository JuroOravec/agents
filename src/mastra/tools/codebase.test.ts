/**
 * Unit tests for the static readCodebaseTool and editCodebaseTool.
 *
 * These tests verify the tool layer delegates correctly to a CodebaseBackend,
 * passing the right arguments and handling the response. The static tools
 * read codebaseBackend from requestContext at execution time.
 * The CodebaseBackend itself is mocked — its implementations are tested separately
 * in src/lib/codebase-backend/codebase-backend.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodebaseBackend } from '../../lib/codebase-backend/index.js';
import { CODEBASE_BACKEND_CONTEXT_KEY, editCodebaseTool, readCodebaseTool } from './codebase.js';

function makeMockCodebaseBackend(): CodebaseBackend {
  return {
    ask: vi.fn().mockResolvedValue('codebase answer'),
    edit: vi.fn().mockResolvedValue('changes applied'),
  };
}

function makeRequestContext(codebaseBackend: CodebaseBackend) {
  const store = new Map<string, unknown>([[CODEBASE_BACKEND_CONTEXT_KEY, codebaseBackend]]);
  return { requestContext: { get: (k: string) => store.get(k) } };
}

describe('readCodebaseTool (static)', () => {
  let codebaseBackend: CodebaseBackend;

  beforeEach(() => {
    codebaseBackend = makeMockCodebaseBackend();
  });

  it('delegates to codebaseBackend.ask when requestContext has codebaseBackend', async () => {
    const context = makeRequestContext(codebaseBackend);
    const result = await readCodebaseTool.execute(
      { query: 'What is config.ts?', context: 'Some context' } as Record<string, unknown>,
      context,
    );

    expect(codebaseBackend.ask).toHaveBeenCalledWith('What is config.ts?', 'Some context');
    expect(result).toBe('codebase answer');
  });

  it('throws when requestContext is missing', async () => {
    await expect(
      readCodebaseTool.execute({ query: 'test' } as Record<string, unknown>, {}),
    ).rejects.toThrow(/codebaseBackend must be set in requestContext/);
  });

  it('throws when codebaseBackend is not in requestContext', async () => {
    const context = { requestContext: { get: () => undefined } };
    await expect(
      readCodebaseTool.execute({ query: 'test' } as Record<string, unknown>, context),
    ).rejects.toThrow(/codebaseBackend must be set in requestContext/);
  });
});

describe('editCodebaseTool (static)', () => {
  let codebaseBackend: CodebaseBackend;

  beforeEach(() => {
    codebaseBackend = makeMockCodebaseBackend();
  });

  it('delegates to codebaseBackend.edit when requestContext has codebaseBackend', async () => {
    const context = makeRequestContext(codebaseBackend);
    const result = await editCodebaseTool.execute(
      { directive: 'Add a comment', context: 'Some context' } as Record<string, unknown>,
      context,
    );

    expect(codebaseBackend.edit).toHaveBeenCalledWith('Add a comment', 'Some context');
    expect(result).toBe('changes applied');
  });

  it('throws when requestContext is missing', async () => {
    await expect(
      editCodebaseTool.execute({ directive: 'test' } as Record<string, unknown>, {}),
    ).rejects.toThrow(/codebaseBackend must be set in requestContext/);
  });

  it('throws when codebaseBackend is not in requestContext', async () => {
    const context = { requestContext: { get: () => undefined } };
    await expect(
      editCodebaseTool.execute({ directive: 'test' } as Record<string, unknown>, context),
    ).rejects.toThrow(/codebaseBackend must be set in requestContext/);
  });
});

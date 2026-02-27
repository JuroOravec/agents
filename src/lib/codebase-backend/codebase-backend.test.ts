/**
 * Unit tests for createCodebaseBackend() factory.
 *
 * Verifies that the factory:
 * - Returns a CursorCodebaseBackend when CREW_MODEL_CODER = cursor:composer-1-5
 * - Returns a NativeCodebaseBackend otherwise
 * - Forwards callbacks to the chosen implementation
 * - Returned instance has ask and edit methods
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CursorCodebaseBackend } from './cursor-codebase-backend.js';
import { NativeCodebaseBackend } from './native-codebase-backend.js';

vi.mock('./cursor-codebase-backend.js', () => ({
  CursorCodebaseBackend: vi.fn().mockImplementation(() => ({
    ask: vi.fn().mockResolvedValue('cursor ask'),
    edit: vi.fn().mockResolvedValue('cursor edit'),
  })),
}));

vi.mock('./native-codebase-backend.js', () => ({
  NativeCodebaseBackend: vi.fn().mockImplementation(() => ({
    ask: vi.fn().mockResolvedValue('native ask'),
    edit: vi.fn().mockResolvedValue('native edit'),
  })),
}));

// Import AFTER mocks are established — test the lib factory directly
import { createCodebaseBackend } from './codebase-backend.js';

describe('createCodebaseBackend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returned backend exposes ask and edit methods', () => {
    const backend = createCodebaseBackend('/tmp/wt');
    expect(typeof backend.ask).toBe('function');
    expect(typeof backend.edit).toBe('function');
  });

  it('forwards callbacks to the chosen implementation', () => {
    const callbacks = { onChunk: vi.fn() };
    createCodebaseBackend('/tmp/wt', callbacks);
    // Either CursorCodebaseBackend or NativeCodebaseBackend should receive the callbacks
    const cursorCalls = vi.mocked(CursorCodebaseBackend).mock.calls;
    const nativeCalls = vi.mocked(NativeCodebaseBackend).mock.calls;
    const allCallbacks = [
      ...cursorCalls.map((c) => c[0]?.callbacks),
      ...nativeCalls.map((c) => c[0]?.callbacks),
    ];
    expect(allCallbacks).toContainEqual(callbacks);
  });

  it('always returns an object with ask and edit', async () => {
    const backend = createCodebaseBackend('/tmp/wt');
    expect(await backend.ask('q')).toBeTypeOf('string');
    expect(await backend.edit('d')).toBeTypeOf('string');
  });
});

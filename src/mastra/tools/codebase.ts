/**
 * Mastra tools for codebase interaction.
 *
 * Two tools are exposed, with different access levels:
 *
 * - `readCodebase`  — read-only Q&A. Safe for Reviewer and Worker.
 *                     Uses CodebaseBackend.ask. Never writes files.
 *
 * - `editCodebase`  — applies code changes and validates via `npm run check:agent`.
 *                     Worker-only. Uses CodebaseBackend.edit.
 *
 * Both tools read `codebaseBackend` from the execution request context. The caller
 * must pass `requestContext` with `codebaseBackend` set when invoking agent.stream().
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import type { CodebaseBackend } from '../../lib/codebase-backend/index.js';

/** Key used in RequestContext to pass the CodebaseBackend to tools. */
export const CODEBASE_BACKEND_CONTEXT_KEY = 'codebaseBackend';

/** Shared Mastra argument unwrapper — handles direct or context-nested args. */
function unwrapArgs(args: Record<string, unknown>): Record<string, unknown> {
  return args && typeof args['context'] === 'object' && args['context'] !== null
    ? (args['context'] as Record<string, unknown>)
    : args;
}

function getCodebaseBackendFromContext(context: {
  requestContext?: { get: (k: string) => unknown };
}): CodebaseBackend {
  const backend = context?.requestContext?.get(CODEBASE_BACKEND_CONTEXT_KEY);
  if (!backend) {
    throw new Error(
      `${CODEBASE_BACKEND_CONTEXT_KEY} must be set in requestContext when using readCodebase/editCodebase tools`,
    );
  }
  return backend as CodebaseBackend;
}

/**
 * Static read-only codebase query tool.
 * Safe for both Reviewer and Worker.
 *
 * Requires `codebaseBackend` in requestContext (set by the caller when invoking agent.stream).
 */
export const readCodebaseTool = createTool({
  id: 'readCodebase',
  description:
    'Ask a question about the codebase or look something up. Read-only — does not modify any files.',
  inputSchema: z.object({
    query: z.string().describe('The question or information request about the codebase.'),
    context: z.string().optional().describe('Optional extra context to scope the answer.'),
  }),
  execute: async (
    args: Record<string, unknown>,
    context: { requestContext?: { get: (k: string) => unknown } },
  ) => {
    const backend = getCodebaseBackendFromContext(context);
    const p = unwrapArgs(args);
    return backend.ask(p['query'] as string, p['context'] as string | undefined);
  },
});

/**
 * Static code-editing tool.
 * Worker-only — do NOT give to the Reviewer.
 *
 * Requires `codebaseBackend` in requestContext (set by the caller when invoking agent.stream).
 */
export const editCodebaseTool = createTool({
  id: 'editCodebase',
  description:
    'Apply code changes to the worktree. Runs validation (npm run check:agent) automatically. ' +
    'Compose a precise directive describing exactly what to implement.',
  inputSchema: z.object({
    directive: z.string().describe('What to implement — be specific and targeted.'),
    context: z.string().optional().describe('Optional extra context or constraints.'),
  }),
  execute: async (
    args: Record<string, unknown>,
    context: { requestContext?: { get: (k: string) => unknown } },
  ) => {
    const backend = getCodebaseBackendFromContext(context);
    const p = unwrapArgs(args);
    return backend.edit(p['directive'] as string, p['context'] as string | undefined);
  },
});

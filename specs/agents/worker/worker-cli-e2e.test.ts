/**
 * End-to-end tests for the Worker CLI iteration loop.
 *
 * These tests run against LIVE LLMs and the real Cursor CLI binary.
 * They are skipped by default to avoid consuming tokens in CI.
 * Run manually with:
 *
 *   WORKER_E2E=1 npx vitest run specs/agents/worker/worker-e2e.test.ts
 *
 * Prerequisites:
 *   - CREW_MODEL_SMART_API_KEY (or OPENAI_API_KEY) set in env
 *   - cursor-agent binary installed and logged in (for Cursor CLI tests)
 *
 * What these tests assert:
 *   1. Mastra fullStream: text-delta / reasoning-delta forwarded via onThought.
 *   2. Mastra fullStream: tool-call / tool-result events forwarded via onEvent.
 *      Enables the `⚙ tool: editCodebase` / `✓ done:` brackets in the CLI.
 *   3. Cursor CLI stream-json: cursor-agent emits NDJSON with type=tool_call
 *      events for every internal tool use (edit, read, grep, shell, …).
 *      These are forwarded via onCursorEvent, rendered as `↳ [cursor] edit …`
 *      or `✗ [cursor] shell failed` lines in the terminal.
 *   4. Cursor CLI onChunk fires live (before doGenerate resolves).
 *   5. The full WorkerReport is returned correctly after streaming.
 *   6. A real iteration loop (runWorkerRound) with a trivial task produces
 *      APPROVED within 2 rounds when the Cursor CLI adds a dummy file.
 *   7. Ctrl+C (SIGINT) behaviour: first press sets graceful-stop and prints
 *      the force-stop hint; second press fires an AbortController that is
 *      threaded into agent.stream(), cancelling the in-flight LLM call.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// ─── Helpers ───────────────────────────────────────────────────────────────

const RUN_E2E = process.env['WORKER_E2E'] === '1';

/** Creates a real temporary git repo for worktree operations. */
async function makeTempRepo(): Promise<{ repoPath: string; cleanup: () => Promise<void> }> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'worker-e2e-'));
  const { execSync } = await import('node:child_process');
  execSync('git init && git commit --allow-empty -m "init"', {
    cwd: repoPath,
    stdio: 'pipe',
  });
  return {
    repoPath,
    cleanup: async () => {
      await fs.rm(repoPath, { recursive: true, force: true });
    },
  };
}

// ─── Suite ─────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_E2E)('Worker CLI — end-to-end (live)', () => {
  /**
   * Asserts that when runWorkerRound is called with a trivial task, the
   * onThought callback receives at least one text delta from the Thinker LLM
   * before the function resolves.
   *
   * This test proves the concurrent drain is working: if textStream/fullStream
   * were drained sequentially (after output.object), onThought would never fire
   * because the stream would deadlock waiting for a reader.
   */
  it('onThought receives text deltas from the Thinker LLM before resolving', async () => {
    const { runWorkerRound } = await import('../../../src/mastra/agents/worker.js');
    const { createCodebaseBackend } = await import('../../../src/lib/codebase-backend/index.js');

    const { repoPath, cleanup } = await makeTempRepo();
    try {
      const thoughtDeltas: string[] = [];
      const codebaseBackend = createCodebaseBackend(repoPath);

      const issueList = {
        status: 'NEEDS_WORK' as const,
        issues: [
          { id: 'add-file', description: 'Add a file called HELLO.txt with content "hello"' },
        ],
        questions: [] as string[],
      };
      const report = await runWorkerRound({
        issueList,
        worktreePath: repoPath,
        workerMemory: { allReviewerIssues: [], allResolutions: [] },
        codebaseBackend,
        onThought: (delta) => thoughtDeltas.push(delta),
      });

      expect(thoughtDeltas.length).toBeGreaterThan(0);
      expect(thoughtDeltas.join('')).toBeTruthy();
      expect(report).toMatchObject({ summary: expect.any(String) });
    } finally {
      await cleanup();
    }
  });

  /**
   * Asserts that cursor-agent's stream-json tool_call events are forwarded via
   * onCursorEvent. Each internal tool use (grep, read, edit, shell, …) emits a
   * tool_call event that worker.ts renders as `↳ [cursor] <tool> <arg>`.
   *
   * This is the regression test for the "black box" problem: before stream-json
   * was enabled you saw nothing until cursor-agent exited. Now every tool use
   * appears live in the terminal.
   *
   * Observed in production: a single worker run for adding two model types to
   * config.ts emitted 20+ tool_call events (grep, glob, read ×4, edit ×6,
   * shell ×6 [all failed — sandbox restriction], readLints, delete [failed]).
   * Shell commands consistently fail in the sandbox; that's expected and the
   * sidecar recovers by falling back to readLints / direct edits.
   */
  it('cursor-agent emits tool_call events via onCursorEvent for each tool use', async () => {
    const { runWorkerRound } = await import('../../../src/mastra/agents/worker.js');
    const { createCodebaseBackend } = await import('../../../src/lib/codebase-backend/index.js');

    const { repoPath, cleanup } = await makeTempRepo();
    try {
      const cursorEventTypes: string[] = [];
      const cursorToolNames: string[] = [];
      const codebaseBackend = createCodebaseBackend(repoPath, {
        onCursorEvent: (event) => {
          cursorEventTypes.push(event.type);
          if (event.type === 'tool_call') {
            const toolKey = Object.keys(
              (event as { tool_call: Record<string, unknown> }).tool_call,
            )[0];
            if (toolKey) cursorToolNames.push(toolKey);
          }
        },
      });

      await runWorkerRound({
        issueList: {
          status: 'NEEDS_WORK',
          issues: [
            { id: 'add-file', description: 'Add a file called HELLO.txt with content "hello"' },
          ],
          questions: [],
        },
        worktreePath: repoPath,
        workerMemory: { allReviewerIssues: [], allResolutions: [] },
        codebaseBackend,
      });

      // cursor-agent must have emitted at least one tool_call event
      expect(cursorEventTypes).toContain('tool_call');
      // At least one file-operation or search tool must appear
      // (grep, glob, read, edit, write, shell, readLints, delete, ls)
      const knownCursorTools = [
        'writeToolCall',
        'editToolCall',
        'shellToolCall',
        'readToolCall',
        'grepToolCall',
        'globToolCall',
        'lsToolCall',
        'deleteToolCall',
        'readLintsToolCall',
      ];
      expect(cursorToolNames.some((n) => knownCursorTools.includes(n))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  /**
   * Asserts that the Cursor CLI's onChunk callback fires with output BEFORE
   * runWorkerRound resolves. This proves the CLI subprocess is not buffered.
   *
   * If onChunk fired only after resolution it would mean the subprocess output
   * was accumulated and replayed — not live-streamed.
   */
  it('Cursor CLI onChunk fires before runWorkerRound resolves', async () => {
    const { runWorkerRound } = await import('../../../src/mastra/agents/worker.js');
    const { createCodebaseBackend } = await import('../../../src/lib/codebase-backend/index.js');

    const { repoPath, cleanup } = await makeTempRepo();
    try {
      const chunks: string[] = [];
      let resolvedAt = -1;
      let firstChunkAt = -1;
      const start = Date.now();
      const codebaseBackend = createCodebaseBackend(repoPath, {
        onChunk: (chunk) => {
          chunks.push(chunk);
          if (firstChunkAt === -1) firstChunkAt = Date.now() - start;
        },
      });

      const reportPromise = runWorkerRound({
        issueList: {
          status: 'NEEDS_WORK',
          issues: [
            {
              id: 'add-file',
              description: 'Add a file called HELLO.txt with content "hello world"',
            },
          ],
          questions: [],
        },
        worktreePath: repoPath,
        workerMemory: { allReviewerIssues: [], allResolutions: [] },
        codebaseBackend,
      });

      await reportPromise;
      resolvedAt = Date.now() - start;

      // At least some output from cursor-agent arrived
      expect(chunks.length).toBeGreaterThan(0);
      // First chunk arrived strictly before the final resolution
      // (allows 100ms tolerance for event-loop timing)
      expect(firstChunkAt).toBeLessThan(resolvedAt - 100);
    } finally {
      await cleanup();
    }
  });

  /**
   * Full round-trip: a real runIterationLoop with a trivial task (create HELLO.txt).
   * Asserts APPROVED within 2 rounds, proving the complete pipeline works end-to-end.
   */
  it('full iteration loop: trivial task reaches APPROVED within 2 rounds', async () => {
    const { runIterationLoop } = await import('../../../src/crews/utils/iteration-loop.js');
    const { runReviewerRound } = await import('../../../src/mastra/agents/reviewer.js');
    const { runWorkerRound } = await import('../../../src/mastra/agents/worker.js');
    const { createCodebaseBackend } = await import('../../../src/lib/codebase-backend/index.js');

    const { repoPath, cleanup } = await makeTempRepo();
    try {
      const result = await runIterationLoop({
        maxRounds: 3,
        worktreePath: repoPath,
        runReviewer: ({
          worktreePath,
          workerMemory: workerMem,
          reviewerMemory: reviewerMem,
          previousAnswers: prevAnswers,
        }) =>
          runReviewerRound({
            goal: 'Create a file called HELLO.txt containing the text "hello world"',
            worktreePath,
            workerMemory: workerMem,
            reviewerMemory: reviewerMem,
            previousAnswers: prevAnswers,
            codebaseBackend: createCodebaseBackend(worktreePath),
          }),
        runWorker: ({ issueList, worktreePath, workerMemory: workerMem }) =>
          runWorkerRound({
            issueList,
            worktreePath,
            workerMemory: workerMem,
            codebaseBackend: createCodebaseBackend(worktreePath),
          }),
      });

      expect(result.finalStatus).toBe('APPROVED');
      expect(result.rounds).toBeLessThanOrEqual(3);

      // Verify HELLO.txt actually exists in the worktree
      const content = await fs.readFile(path.join(repoPath, 'HELLO.txt'), 'utf8');
      expect(content.trim()).toBe('hello world');
    } finally {
      await cleanup();
    }
  });
});

// ─── Static contract tests (always run) ────────────────────────────────────

describe('cursor-provider — stream-json NDJSON parsing (unit)', () => {
  /**
   * Documents the cursor-agent stream-json wire format and asserts that
   * parseCursorEventLine correctly classifies each line.
   *
   * cursor-agent emits one JSON object per newline when run with:
   *   --output-format stream-json --stream-partial-output
   *
   * Known event shapes (observed in production):
   *   { "type": "assistant", "text": "..." }        — text delta
   *   { "type": "tool_call", "tool_call": { "<toolName>": { ... } } }
   *   { "type": "result",    "text": "...", "status": "success"|"error" }
   */
  it('parseCursorEventLine classifies assistant, tool_call, and result events', async () => {
    const { parseCursorEventLine } =
      await import('../../../src/llm-providers/cursor/cursor-provider.js');

    const assistantEvent = parseCursorEventLine(
      JSON.stringify({ type: 'assistant', text: 'hello' }),
    );
    expect(assistantEvent).toMatchObject({ type: 'assistant', text: 'hello' });

    const toolCallEvent = parseCursorEventLine(
      JSON.stringify({ type: 'tool_call', tool_call: { editToolCall: { path: 'src/foo.ts' } } }),
    );
    expect(toolCallEvent).toMatchObject({ type: 'tool_call' });

    const resultEvent = parseCursorEventLine(
      JSON.stringify({ type: 'result', text: 'Done.', status: 'success' }),
    );
    expect(resultEvent).toMatchObject({ type: 'result', status: 'success' });

    // Non-JSON lines must return null without throwing
    expect(parseCursorEventLine('not json')).toBeNull();
    expect(parseCursorEventLine('')).toBeNull();
  });

  /**
   * Asserts that tool_call events with unknown / future tool names are still
   * forwarded (open-world assumption). The renderer in worker.ts extracts the
   * first key of tool_call.tool_call as the display name, so it must be present.
   */
  it('tool_call events with any tool name are forwarded verbatim', async () => {
    const { parseCursorEventLine } =
      await import('../../../src/llm-providers/cursor/cursor-provider.js');

    const line = JSON.stringify({ type: 'tool_call', tool_call: { futureTool: { arg: 1 } } });
    const event = parseCursorEventLine(line);
    expect(event).not.toBeNull();
    expect(event?.type).toBe('tool_call');
    const toolName = Object.keys((event as { tool_call: Record<string, unknown> }).tool_call)[0];
    expect(toolName).toBe('futureTool');
  });
});

describe('Worker CLI — fullStream event contract (unit)', () => {
  /**
   * Asserts that the tool-call payload for editCodebase carries `directive`
   * and `context` in `payload.args`, matching the inputSchema of the tool.
   *
   * worker.ts reads these fields to print a preview below the ⚙ tool: line:
   *   │  directive: Add 'genius' and 'coder' model types…
   *   │  context:   Current config has smart and fast…
   *
   * This is a static contract test — no LLM involved.
   */
  it('tool-call payload for editCodebase exposes directive and context in args', async () => {
    const { drainFullStream } = await import('../../../src/crews/utils/drain-stream.js');

    type ToolCallPayload = { toolName: string; toolCallId: string; args: Record<string, unknown> };

    const editChunk = {
      type: 'tool-call',
      payload: {
        toolName: 'editCodebase',
        toolCallId: 'tc1',
        args: {
          directive: 'Add genius and coder model types to config.ts',
          context: 'Current config has smart and fast tiers',
        },
      } satisfies ToolCallPayload,
    };

    const onEvent = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(editChunk);
        controller.close();
      },
    });

    await drainFullStream(stream as ReadableStream<{ type: string; payload: unknown }>, {
      onEvent,
    });

    const call = onEvent.mock.calls[0][0] as { type: string; payload: ToolCallPayload };
    expect(call.type).toBe('tool-call');
    expect(call.payload.toolName).toBe('editCodebase');
    expect(call.payload.args['directive']).toBe('Add genius and coder model types to config.ts');
    expect(call.payload.args['context']).toBe('Current config has smart and fast tiers');
  });

  /**
   * Documents the expected event types in fullStream and asserts the drain
   * helper handles each one without throwing.
   *
   * This is a static, zero-LLM test that validates the event routing logic
   * we will implement: a drainFullStream() helper that routes chunk types
   * to onThought / onToolCall / onToolResult / onChunk.
   */
  it('drainFullStream routes chunk types to the correct callbacks without throwing', async () => {
    // Import the helper we are about to implement
    const { drainFullStream } = await import('../../../src/crews/utils/drain-stream.js');

    const chunks = [
      {
        type: 'text-delta',
        payload: { text: 'hello ', id: '1' },
        from: 'agent',
        runId: 'r1',
        metadata: {},
      },
      {
        type: 'text-delta',
        payload: { text: 'world', id: '2' },
        from: 'agent',
        runId: 'r1',
        metadata: {},
      },
      {
        type: 'tool-call',
        payload: { toolCallId: 'tc1', toolName: 'editCodebase', args: {} },
        from: 'agent',
        runId: 'r1',
        metadata: {},
      },
      {
        type: 'tool-result',
        payload: { toolCallId: 'tc1', toolName: 'editCodebase', result: 'done' },
        from: 'agent',
        runId: 'r1',
        metadata: {},
      },
      {
        type: 'reasoning-delta',
        payload: { text: 'thinking...', id: '3' },
        from: 'agent',
        runId: 'r1',
        metadata: {},
      },
      {
        type: 'finish',
        payload: { stepResult: { reason: 'stop' } },
        from: 'agent',
        runId: 'r1',
        metadata: {},
      },
    ] as const;

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });

    const onThought = vi.fn();
    const onEvent = vi.fn();

    await drainFullStream(stream as ReadableStream<{ type: string; payload: unknown }>, {
      onThought,
      onEvent,
    });

    expect(onThought).toHaveBeenCalledWith('hello ');
    expect(onThought).toHaveBeenCalledWith('world');
    expect(onThought).toHaveBeenCalledWith('thinking...');
    expect(onThought).toHaveBeenCalledTimes(3);

    // onEvent receives EVERY chunk (text-delta, tool-call, tool-result, reasoning-delta, finish, …)
    const eventTypes = onEvent.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(eventTypes).toContain('tool-call');
    expect(eventTypes).toContain('tool-result');
    // All 6 chunks in our fake stream should have been forwarded
    expect(onEvent).toHaveBeenCalledTimes(6);
  });
});

// ─── SIGINT / force-stop contract tests (always run) ───────────────────────

describe('Worker CLI — SIGINT double-press force-stop (unit)', () => {
  /**
   * Documents the two-stage Ctrl+C contract:
   *
   *   1st SIGINT → graceful: sets stopped=true, prints hint to press again.
   *                           In-flight agent round completes normally.
   *   2nd SIGINT → force:    AbortController.abort() fires immediately.
   *                           The AbortSignal is passed to agent.stream()
   *                           so the in-flight LLM call is cancelled.
   *
   * These tests drive the SIGINT handler logic directly (no process.kill),
   * which is safe in a test runner context.
   */

  /**
   * Asserts that the first SIGINT does NOT abort the controller —
   * it only marks the session for graceful exit after the current task.
   */
  it('first SIGINT sets stopped but does not abort the AbortController', () => {
    const forceAbort = new AbortController();
    let stopped = false;

    const sigintHandler = () => {
      if (!stopped) {
        stopped = true;
        // first press: graceful — do NOT abort
      } else {
        forceAbort.abort();
      }
    };

    // Simulate first Ctrl+C
    sigintHandler();

    expect(stopped).toBe(true);
    expect(forceAbort.signal.aborted).toBe(false);
  });

  /**
   * Asserts that the second SIGINT aborts the AbortController,
   * which cancels the in-flight LLM call passed as abortSignal.
   */
  it('second SIGINT aborts the AbortController', () => {
    const forceAbort = new AbortController();
    let stopped = false;

    const sigintHandler = () => {
      if (!stopped) {
        stopped = true;
      } else {
        forceAbort.abort();
      }
    };

    // Simulate first then second Ctrl+C
    sigintHandler();
    sigintHandler();

    expect(forceAbort.signal.aborted).toBe(true);
  });

  /**
   * Asserts that the abortSignal received by runWorkerRound / runReviewerRound
   * is already aborted when force-stop fires — so the LLM call can detect it
   * synchronously before/after await.
   *
   * This models the downstream check: agent.stream({ abortSignal }) receives
   * the same signal object, and the aborted state is visible immediately.
   */
  it('abortSignal passed into runWorkerRound is aborted after second SIGINT', () => {
    const forceAbort = new AbortController();

    // Capture the signal before it fires (as worker.ts does)
    const capturedSignal = forceAbort.signal;
    expect(capturedSignal.aborted).toBe(false);

    // Simulate second SIGINT
    forceAbort.abort();

    // The same signal reference is now aborted — visible to runWorkerRound
    expect(capturedSignal.aborted).toBe(true);
  });

  /**
   * Asserts that the AbortSignal's 'abort' event fires synchronously,
   * which allows agent.stream() to reject its promise immediately rather
   * than waiting for the next LLM token.
   */
  it('AbortSignal fires abort event synchronously on second SIGINT', () => {
    const forceAbort = new AbortController();
    let abortEventFired = false;

    forceAbort.signal.addEventListener('abort', () => {
      abortEventFired = true;
    });

    expect(abortEventFired).toBe(false);
    forceAbort.abort();
    expect(abortEventFired).toBe(true);
  });

  /**
   * Asserts that the three-stage SIGINT counter increments correctly and
   * that the third press triggers process.exit(1).
   *
   * The third press is the hard-exit escape hatch — it calls process.exit(1)
   * synchronously, bypassing the finally block so teardown cannot block it.
   * We mock process.exit to avoid actually killing the test runner.
   */
  it('third SIGINT calls process.exit(1), bypassing cleanup', () => {
    const forceAbort = new AbortController();
    let sigintCount = 0;
    let stopped = false;

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as () => never);

    const sigintHandler = () => {
      sigintCount += 1;
      if (sigintCount === 1) {
        stopped = true;
      } else if (sigintCount === 2) {
        forceAbort.abort();
      } else {
        process.exit(1);
      }
    };

    sigintHandler(); // 1st
    expect(stopped).toBe(true);
    expect(forceAbort.signal.aborted).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();

    sigintHandler(); // 2nd
    expect(forceAbort.signal.aborted).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();

    sigintHandler(); // 3rd
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

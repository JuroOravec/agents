#!/usr/bin/env node
/**
 * CLI runner for the AI Software Factory Iteration Loop (worker).
 *
 * Runs in interactive mode by default: after each task completes, the user is
 * prompted for the next task. The session keeps the worktree alive and commits
 * progress after every task. Only on explicit exit (quit/stop/Ctrl+C/Ctrl+D)
 * is the worktree cleaned up.
 *
 * Visual identity:
 *   dim gray     — system/orchestrator messages (worktree, commits, cleanup)
 *   cyan         — Reviewer output (analysis, status, issues, questions)
 *   cyan dim     — Reviewer live thoughts (streamed tokens, shown with --thoughts)
 *   yellow       — Worker output (implementation, file changes)
 *   yellow dim   — Worker live thoughts / Cursor CLI chunks (shown with --thoughts)
 *   green bold   — success/APPROVED
 *   red          — errors
 *
 * Usage:
 *   pnpm run demo-worker -- --goal "Fix the math function in src/math.ts"
 *   pnpm run demo-worker -- --goal "Implement auth" --no-interactive
 *   pnpm run demo-worker -- --goal "Implement auth" --max-rounds 5 --keep-worktree
 *   pnpm run demo-worker -- --goal "Implement auth" --no-thoughts
 *   pnpm run demo-worker -- --goal "Implement auth" --no-discovery
 */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

import { runSkillDiscovery, type SkillCandidateIssue } from '../src/crews/skill-discovery.js';
import type { DrainableChunk } from '../src/crews/utils/drain-stream.js';
import {
  runIterationLoop,
  type RunReviewerOpts,
  type RunWorkerOpts,
} from '../src/crews/utils/iteration-loop.js';
import { runCheckAndDecide } from '../src/crews/utils/run-check-agent.js';
import {
  createCodebaseBackend,
  makeCursorEventHandler,
} from '../src/lib/codebase-backend/index.js';
import { runReviewerRound } from '../src/mastra/agents/reviewer.js';
import { runWorkerRound } from '../src/mastra/agents/worker.js';
import {
  cleanupWorktree,
  commitWorktree,
  createWorktree,
  mergeWorktreeBranch,
} from '../src/utils/git-worktree.js';

const execFileAsync = promisify(execFile);

// Configure marked to render markdown for the terminal.
// @ts-expect-error - markedTerminal is a valid marked extension
marked.use(markedTerminal());

/** Renders a markdown string to a terminal-friendly format. */
function renderMd(text: string): string {
  return String(marked(text)).trim();
}

// ─── Visual identity helpers ───────────────────────────────────────────────

/** System / orchestrator messages (dim, neutral). */
const sys = {
  info: (msg: string) => clack.log.info(chalk.dim(msg)),
  step: (msg: string) => clack.log.step(chalk.dim(msg)),
  success: (msg: string) => clack.log.success(chalk.green.bold(msg)),
  error: (msg: string) => clack.log.error(chalk.red(msg)),
};

/** Reviewer messages (cyan). */
const reviewer = {
  log: (msg: string) => clack.log.message(chalk.cyan(`[Reviewer] ${msg}`)),
  issue: (id: string, desc: string) => clack.log.warn(chalk.cyan(`  · [${id}] ${desc}`)),
  question: (i: number, q: string) => clack.log.message(chalk.cyan(`  ${i}. ${q}`)),
};

/** Worker messages (yellow). */
const worker = {
  log: (msg: string) => clack.log.message(chalk.yellow(`[Worker] ${msg}`)),
  summary: (text: string) => clack.log.message(chalk.yellow(`  Summary: ${renderMd(text)}`)),
};

/**
 * Builds a streaming "thought" writer for an agent.
 * Returns an `onThought` callback and a `flush` function.
 * Chunks are written inline (no newline) until `flush()` is called to close the block.
 *
 * @param prefix - Colored prefix written before the first chunk of a new line.
 * @param color - Chalk color function to apply to each delta.
 */
function makeThoughtWriter(prefix: string, color: (s: string) => string) {
  let started = false;
  return {
    onThought: (delta: string) => {
      if (!started) {
        process.stdout.write(prefix);
        started = true;
      }
      process.stdout.write(color(delta));
    },
    flush: () => {
      if (started) {
        process.stdout.write('\n');
        started = false;
      }
    },
  };
}

/**
 * Builds an `onEvent` handler that logs tool-call and tool-result events from the
 * Thinker LLM's Mastra fullStream (e.g. when it calls `editCodebase` or `readCodebase`).
 * Flushes any active thought line before printing tool events so output doesn't overlap.
 *
 * @param flush - Flush function from a paired makeThoughtWriter to close any open line.
 * @param toolColor - Chalk color for the tool event lines.
 */
function makeEventHandler(flush: () => void, toolColor: (s: string) => string) {
  return (chunk: DrainableChunk) => {
    if (chunk.type === 'tool-call') {
      const p = chunk.payload as {
        toolName?: string;
        toolCallId?: string;
        args?: Record<string, unknown>;
      };
      flush();
      clack.log.step(toolColor(`  ⚙ tool: ${p.toolName ?? '?'}  (${p.toolCallId ?? ''})`));
      if (!p.args) return;
      // editCodebase: directive + context
      if (p.toolName === 'editCodebase') {
        const directive = p.args['directive'] as string | undefined;
        const context = p.args['context'] as string | undefined;
        if (directive) {
          const truncated = directive.length > 200 ? `${directive.slice(0, 200)}…` : directive;
          clack.log.message(toolColor(`  │  directive: ${chalk.dim(truncated)}`));
        }
        if (context) {
          const truncated = context.length > 120 ? `${context.slice(0, 120)}…` : context;
          clack.log.message(toolColor(`  │  context:   ${chalk.dim(truncated)}`));
        }
      }
      // readCodebase: query + context
      else if (p.toolName === 'readCodebase') {
        const query = p.args['query'] as string | undefined;
        const context = p.args['context'] as string | undefined;
        if (query) {
          const truncated = query.length > 200 ? `${query.slice(0, 200)}…` : query;
          clack.log.message(toolColor(`  │  query:    ${chalk.dim(truncated)}`));
        }
        if (context) {
          const truncated = context.length > 120 ? `${context.slice(0, 120)}…` : context;
          clack.log.message(toolColor(`  │  context:  ${chalk.dim(truncated)}`));
        }
      }
    } else if (chunk.type === 'tool-result') {
      const p = chunk.payload as { toolName?: string; isError?: boolean };
      const icon = p.isError ? '✗' : '✓';
      flush();
      clack.log.step(toolColor(`  ${icon} done:  ${p.toolName ?? '?'}`));
    }
  };
}

/** Wires makeCursorEventHandler's log callback to clack + chalk. */
function cursorEventLogger(color: (s: string) => string) {
  return (line: string, isFailure: boolean) => {
    const c = color(line);
    if (isFailure) clack.log.warn(c);
    else clack.log.step(c);
  };
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface CliOpts {
  jobId: string;
  worktreePath: string;
  maxRounds: number;
  skipQuestions: boolean;
  /** When true, stream model reasoning tokens to the terminal as they arrive. Default: true. */
  showThoughts: boolean;
  /** When true, skip post-approval skill discovery (no gh issue list/create). */
  skipDiscovery: boolean;
  /** When true, auto-merge the worktree branch into the current branch on cleanup. */
  doMerge: boolean;
  /** Path to main repo (for git merge). */
  repoRoot: string;
  /** When set, in-flight LLM calls are aborted when this signal fires (force-stop). */
  abortSignal?: AbortSignal;
}

// ─── Loop callbacks ────────────────────────────────────────────────────────

/** Builds the shared runReviewer / runWorker / onQuestions callbacks for a given goal. */
function buildLoopCallbacks(goal: string, opts: CliOpts) {
  const { skipQuestions, showThoughts, abortSignal } = opts;

  return {
    runReviewer: async (opts: RunReviewerOpts) => {
      const { worktreePath, workerMemory, reviewerMemory, previousAnswers } = opts;
      // Run check:agent programmatically. If it fails, bypass Reviewer and
      // return a synthetic issue list directly to the Worker.
      reviewer.log('Running validation (npm run check:agent)...');
      const decision = await runCheckAndDecide(worktreePath);

      if (decision.action === 'bypass_to_worker') {
        reviewer.log(chalk.yellow('Validation: FAILED — bypassing Reviewer, sending to Worker'));
        reviewer.log(`Status: NEEDS_WORK`);
        decision.issueList.issues.forEach((issue) => reviewer.issue(issue.id, issue.description));
        return decision.issueList;
      }

      reviewer.log(chalk.dim('Validation: PASSED'));
      reviewer.log('Analyzing current state against goal...');
      const { onThought, flush } = makeThoughtWriter(
        chalk.cyan.dim('│  [Reviewer thinking] '),
        chalk.cyan.dim,
      );
      const onEvent = showThoughts ? makeEventHandler(flush, chalk.cyan.dim) : undefined;

      // Reviewer gets a read-only codebase backend (ask mode only).
      const reviewerCodebaseBackend = createCodebaseBackend(
        worktreePath,
        showThoughts
          ? {
              onChunk: (chunk) => process.stdout.write(chalk.cyan.dim(chunk)),
              onCursorEvent: makeCursorEventHandler(flush, cursorEventLogger(chalk.cyan.dim)),
            }
          : {},
      );

      const issueList = await runReviewerRound({
        goal,
        worktreePath,
        workerMemory,
        reviewerMemory,
        previousAnswers,
        onThought: showThoughts ? onThought : undefined,
        onEvent,
        abortSignal,
        codebaseBackend: reviewerCodebaseBackend,
        checkResult: decision.checkResult,
      });
      flush();

      if (issueList.status === 'APPROVED') {
        reviewer.log(chalk.green.bold('APPROVED'));
      } else {
        reviewer.log(`Status: NEEDS_WORK`);
        if (issueList.issues.length > 0) {
          reviewer.log(`Issues found (${issueList.issues.length}):`);
          issueList.issues.forEach((issue) => reviewer.issue(issue.id, issue.description));
        }
        if (issueList.questions.length > 0) {
          reviewer.log(`Has ${issueList.questions.length} clarification question(s)`);
        }
      }
      return issueList;
    },

    onQuestions: async (questions: string[]) => {
      reviewer.log('Needs clarification before proceeding:');
      questions.forEach((q, i) => reviewer.question(i + 1, q));

      if (skipQuestions) {
        reviewer.log(chalk.dim('Auto-skipping (--yes). Proceeding without answers.'));
        return [];
      }

      const answers: string[] = [];
      for (const [i, question] of questions.entries()) {
        const answer = await clack.text({
          message: chalk.cyan(`Answer ${i + 1}: ${question}`),
          placeholder: 'Type your answer...',
        });
        if (clack.isCancel(answer)) {
          clack.cancel('Cancelled.');
          process.exit(0);
        }
        answers.push(String(answer).trim());
      }
      return answers;
    },

    runWorker: async (opts: RunWorkerOpts) => {
      const { issueList, worktreePath, workerMemory } = opts;
      const startMsg =
        issueList.status === 'WORK_STARTED'
          ? 'Starting work on initial task...'
          : 'Implementing changes...';
      worker.log(startMsg);

      // Stream Thinker (Worker LLM) reasoning tokens and tool-call events live.
      const { onThought, flush: flushThoughts } = makeThoughtWriter(
        chalk.yellow.dim('│  [Worker thinking] '),
        chalk.yellow.dim,
      );
      const onEvent = showThoughts ? makeEventHandler(flushThoughts, chalk.yellow.dim) : undefined;

      // Worker codebase backend gets both read and write, with streaming callbacks.
      const workerCodebaseBackend = createCodebaseBackend(
        worktreePath,
        showThoughts
          ? {
              onChunk: (chunk) => process.stdout.write(chalk.yellow.dim(chunk)),
              onCursorEvent: makeCursorEventHandler(
                flushThoughts,
                cursorEventLogger(chalk.yellow.dim),
              ),
              onEvent: makeEventHandler(flushThoughts, chalk.yellow.dim),
            }
          : {},
      );

      const report = await runWorkerRound({
        issueList,
        worktreePath,
        workerMemory,
        codebaseBackend: workerCodebaseBackend,
        onThought: showThoughts ? onThought : undefined,
        onEvent,
        abortSignal,
      });
      // Ensure the next log line starts on a fresh line after streamed output.
      flushThoughts();
      worker.summary(report.summary);
      worker.log(`Files changed: ${report.codeChanges.length}`);
      return report;
    },
  };
}

// ─── Session helpers ───────────────────────────────────────────────────────

/** Runs a single iteration loop for one goal. Returns the loop result. */
async function runSingleTask(goal: string, opts: CliOpts) {
  const { maxRounds, worktreePath } = opts;
  const spin = clack.spinner();
  spin.start(
    chalk.dim(`Running iteration loop (max ${maxRounds === Infinity ? '∞' : maxRounds} rounds)...`),
  );

  const callbacks = buildLoopCallbacks(goal, opts);
  // Stop the global spinner before the loop starts emitting its own log lines.
  spin.stop(chalk.dim('Loop started.'));

  const result = await runIterationLoop({
    maxRounds,
    worktreePath,
    skipInitialReview: true,
    initialGoal: goal,
    ...callbacks,
  });

  const statusLine =
    result.finalStatus === 'APPROVED'
      ? chalk.green.bold(`APPROVED after ${result.rounds} round(s)`)
      : result.finalStatus === 'ABORTED'
        ? chalk.dim(`Aborted after ${result.rounds} round(s)`)
        : chalk.yellow(`${result.finalStatus} — ${result.rounds} round(s) completed`);

  clack.note(statusLine, chalk.dim('Iteration Loop Complete'));

  // Post-approval: skill discovery (unless --no-discovery)
  if (result.finalStatus === 'APPROVED' && !opts.skipDiscovery) {
    await runPostApprovalSkillDiscovery({ goal, worktreePath, result, cliOpts: opts });
  }

  return result;
}

/** Lists open issues with label skill-candidate. Returns [] on failure (no gh, no auth, etc.). */
async function listSkillCandidateIssues(): Promise<SkillCandidateIssue[]> {
  try {
    const { stdout } = (await execFileAsync('gh', [
      'issue',
      'list',
      '--label',
      'skill-candidate',
      '--state',
      'open',
      '--json',
      'number,title,body,url',
      '--limit',
      '50',
    ])) as { stdout: string; stderr: string };
    const parsed = JSON.parse(String(stdout ?? '[]')) as SkillCandidateIssue[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Runs skill discovery after APPROVED and creates a GitHub issue when appropriate. */
async function runPostApprovalSkillDiscovery(args: {
  goal: string;
  worktreePath: string;
  result: Awaited<ReturnType<typeof runIterationLoop>>;
  cliOpts: CliOpts;
}) {
  const { goal, worktreePath, result, cliOpts: opts } = args;
  sys.step('Running post-approval skill discovery...');

  const existingIssues = await listSkillCandidateIssues();

  const { onThought, flush } = makeThoughtWriter(chalk.dim('│  [SkillDiscovery] '), chalk.dim);
  const onEvent = opts.showThoughts ? makeEventHandler(flush, chalk.dim) : undefined;

  const skillDiscoveryBackend = createCodebaseBackend(
    worktreePath,
    opts.showThoughts
      ? {
          onChunk: (chunk) => process.stdout.write(chalk.dim(chunk)),
          onCursorEvent: makeCursorEventHandler(flush, cursorEventLogger(chalk.dim)),
        }
      : {},
  );

  try {
    const discovery = await runSkillDiscovery({
      goal,
      worktreePath,
      workerMemory: result.workerMemory,
      reviewerMemory: result.reviewerMemory,
      existingSkillCandidateIssues: existingIssues,
      codebaseBackend: skillDiscoveryBackend,
      onThought: opts.showThoughts ? onThought : undefined,
      onEvent,
      abortSignal: opts.abortSignal,
    });
    flush();

    if (discovery.skillExists) {
      sys.success(
        `Similar skill exists at ${discovery.existingSkillPath ?? 'unknown'}. No issue created.`,
      );
    } else if (discovery.existingIssueMatch) {
      sys.success(
        `Relevant skill-candidate issue already exists: #${discovery.existingIssueMatch.number} ${discovery.existingIssueMatch.url}`,
      );
    } else if (discovery.suggestedIssue) {
      const { title, body } = discovery.suggestedIssue;
      const { stdout } = (await execFileAsync('gh', [
        'issue',
        'create',
        '--title',
        title,
        '--body',
        body,
        '--label',
        'skill-candidate',
      ])) as { stdout: string; stderr: string };
      const issueRef = String(stdout ?? '').trim();
      sys.success(
        issueRef
          ? `Created GitHub issue with label skill-candidate: ${issueRef}`
          : 'Created GitHub issue with label skill-candidate.',
      );
    } else {
      sys.info(
        chalk.dim('No similar skill found; suggestedIssue was empty. Skipping issue creation.'),
      );
    }
  } catch (err) {
    sys.error(`Skill discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    // Do not rethrow — skill discovery is non-blocking; the iteration loop already succeeded.
  }
}

/** Commits current worktree progress with a descriptive message. */
async function commitProgress(worktreePath: string, goal: string) {
  const spin = clack.spinner();
  spin.start(chalk.dim('Committing progress...'));
  await commitWorktree(worktreePath, `worker: ${goal}`);
  spin.stop(chalk.dim('Progress committed.'));
}

/** Cleans up the worktree and prints handoff instructions. */
async function finalizeSession(opts: CliOpts, keepWorktree: boolean) {
  const { jobId, worktreePath, doMerge, repoRoot } = opts;

  if (keepWorktree) {
    sys.info(`Worktree preserved at: ${worktreePath} (branch: crew/${jobId})`);
    return;
  }

  let deleteBranch = false;
  if (doMerge) {
    const spinMerge = clack.spinner();
    spinMerge.start(chalk.dim('Merging worktree branch into current branch...'));
    const mergeResult = await mergeWorktreeBranch(jobId, repoRoot);
    spinMerge.stop();
    if (mergeResult.ok) {
      sys.success('Branch merged successfully.');
      deleteBranch = true;
    } else {
      sys.error(`Merge failed: ${mergeResult.error ?? 'unknown'}`);
      sys.info(chalk.dim('Branch preserved. Merge manually: git merge crew/' + jobId));
    }
  }

  const spin = clack.spinner();
  spin.start(chalk.dim('Cleaning up worktree...'));
  await cleanupWorktree(jobId, deleteBranch);
  spin.stop(chalk.dim('Worktree removed.'));

  if (!doMerge || !deleteBranch) {
    clack.outro(
      chalk.green.bold(`Session complete!`) +
        chalk.dim(`\n  Branch: crew/${jobId}\n  Merge with: git merge crew/${jobId}`),
    );
  } else {
    clack.outro(chalk.green.bold('Session complete! Branch merged.'));
  }
}

/** Runs the interactive session loop: task → commit → prompt → repeat until quit. */
async function runInteractiveSession(args: {
  initialGoal: string;
  cliOpts: CliOpts;
  keepWorktree: boolean;
}) {
  const { initialGoal, cliOpts: opts, keepWorktree } = args;
  let stopped = false;
  let currentGoal = initialGoal;

  // Three-stage Ctrl+C:
  //   1st SIGINT → graceful stop (finish current task, then clean up)
  //   2nd SIGINT → force stop  (abort in-flight LLM, then clean up)
  //   3rd SIGINT → hard exit   (process.exit — escape hatch if teardown is stuck)
  const forceAbort = new AbortController();
  const sessionOpts = { ...opts, abortSignal: forceAbort.signal };
  let sigintCount = 0;

  const sigintHandler = () => {
    sigintCount += 1;
    console.log();
    if (sigintCount === 1) {
      stopped = true;
      sys.info('Ctrl+C received — finishing current task then cleaning up.');
      sys.info(chalk.dim('Press Ctrl+C again to force-stop immediately.'));
    } else if (sigintCount === 2) {
      sys.error('Force-stopping. Aborting in-flight agent and tearing down worktree...');
      sys.info(chalk.dim('Press Ctrl+C once more to exit immediately, skipping cleanup.'));
      forceAbort.abort();
    } else {
      // Third press — hard exit, bypass finally block entirely
      sys.error('Hard exit. Skipping cleanup — worktree may need manual removal.');
      sys.info(chalk.dim(`  Worktree: ${opts.worktreePath}`));
      sys.info(chalk.dim(`  Branch:   crew/${opts.jobId}`));
      process.exit(1);
    }
  };
  process.on('SIGINT', sigintHandler);

  try {
    while (!stopped) {
      clack.note(chalk.white.bold(currentGoal), chalk.dim('Current Task'));
      const taskResult = await runSingleTask(currentGoal, sessionOpts);

      const isAborted = forceAbort.signal.aborted || taskResult.finalStatus === 'ABORTED';

      // Always commit progress, even if aborted, so partial changes are saved on the branch.
      await commitProgress(opts.worktreePath, currentGoal + (isAborted ? ' (aborted)' : ''));

      if (isAborted) break;

      if (stopped) break;

      const nextTask = await clack.text({
        message: chalk.dim('Next task (type to continue, leave empty to finish):'),
        placeholder: 'or press Enter / Ctrl+C to quit',
      });

      if (clack.isCancel(nextTask) || !String(nextTask ?? '').trim()) {
        stopped = true;
      } else {
        const trimmed = String(nextTask).trim().toLowerCase();
        if (trimmed === 'quit' || trimmed === 'stop') {
          stopped = true;
        } else {
          currentGoal = String(nextTask).trim();
        }
      }
    }
  } finally {
    process.off('SIGINT', sigintHandler);
    if (forceAbort.signal.aborted) {
      // Skip commit on force-stop — partial changes stay in the worktree branch
      sys.info('Session force-stopped. Partial changes are on the worktree branch.');
    }
    await finalizeSession(opts, keepWorktree);
  }
}

// ─── Main CLI ──────────────────────────────────────────────────────────────

export async function runCli(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      goal: { type: 'string', short: 'g' },
      'max-rounds': { type: 'string', short: 'm' },
      'no-interactive': { type: 'boolean', short: 'n' },
      'keep-worktree': { type: 'boolean', short: 'k' },
      merge: { type: 'boolean', short: 'M' },
      yes: { type: 'boolean', short: 'y' },
      'no-thoughts': { type: 'boolean' },
      'no-discovery': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: false,
  });

  const HELP = `Usage:
  npm run demo-worker -- --goal "Your specific goal or issue description"

Options:
  -g, --goal           The initial task or issue to implement (required)
  -m, --max-rounds     Max iteration rounds per task (default: Infinity in interactive, 3 with --no-interactive)
  -n, --no-interactive Single-run mode: run once, commit, cleanup, exit
  -k, --keep-worktree  Do not delete the git worktree after completion
  -M, --merge          Auto-merge the worktree branch into the current branch on cleanup
  -y, --yes            Skip waiting for human clarification questions
      --no-thoughts    Hide live model reasoning tokens (thoughts shown by default)
      --no-discovery   Skip post-approval skill discovery (no gh issue list/create)

Interactive mode (default):
  After each task completes, you are prompted for the next task.
  Type "quit" or "stop" (or press Ctrl+D/Ctrl+C) to end the session.
  With --merge, the branch is auto-merged on exit; otherwise merge manually when done.
`;

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (!values.goal) {
    console.error(HELP);
    throw new Error('Missing required argument: --goal');
  }

  const goal = String(values.goal);
  const noInteractive = Boolean(values['no-interactive']);
  const keepWorktree = Boolean(values['keep-worktree']);
  const doMerge = Boolean(values.merge);
  const skipQuestions = Boolean(values['yes']);
  const showThoughts = !values['no-thoughts'];
  const skipDiscovery = Boolean(values['no-discovery']);
  const repoRoot = process.cwd();
  const maxRounds = values['max-rounds']
    ? parseInt(String(values['max-rounds']), 10)
    : noInteractive
      ? 3
      : Infinity;

  const jobId = `worker-${Date.now()}`;

  clack.intro(chalk.bold('worker') + chalk.dim(` · Software Factory Iteration Loop`));
  clack.log.step(chalk.white.bold(`Goal: ${goal}`));
  sys.info(
    noInteractive
      ? `Mode: single-run · max ${maxRounds} rounds`
      : `Mode: interactive · type "quit" or "stop" when done`,
  );
  if (doMerge) sys.info('Auto-merge on cleanup (--merge)');
  if (skipQuestions) sys.info('Auto-answering Reviewer questions (--yes)');
  if (!showThoughts) sys.info('Thoughts hidden (--no-thoughts)');
  if (skipDiscovery) sys.info('Skill discovery disabled (--no-discovery)');

  const spin = clack.spinner();
  spin.start(chalk.dim('Creating isolated git worktree...'));
  const worktreePath = await createWorktree(jobId);
  spin.stop(chalk.dim(`Worktree ready: ${worktreePath}  (branch: crew/${jobId})`));

  const opts: CliOpts = {
    jobId,
    worktreePath,
    maxRounds,
    skipQuestions,
    showThoughts,
    skipDiscovery,
    doMerge,
    repoRoot,
  };

  try {
    if (noInteractive) {
      const result = await runSingleTask(goal, opts);
      await commitProgress(worktreePath, goal);

      if (!keepWorktree) {
        const branchPreserved = result.finalStatus === 'APPROVED';
        let deleteBranch = !branchPreserved;

        if (doMerge && branchPreserved) {
          const spinMerge = clack.spinner();
          spinMerge.start(chalk.dim('Merging worktree branch into current branch...'));
          const mergeResult = await mergeWorktreeBranch(jobId, repoRoot);
          spinMerge.stop();
          if (mergeResult.ok) {
            sys.success('Branch merged successfully.');
            deleteBranch = true;
          } else {
            sys.error(`Merge failed: ${mergeResult.error ?? 'unknown'}`);
            sys.info(chalk.dim('Branch preserved. Merge manually: git merge crew/' + jobId));
          }
        }

        const spin2 = clack.spinner();
        spin2.start(chalk.dim('Cleaning up worktree directory...'));
        await cleanupWorktree(jobId, deleteBranch);
        spin2.stop(chalk.dim('Worktree removed.'));

        if (branchPreserved && !doMerge) {
          clack.outro(
            chalk.green.bold('SUCCESS!') +
              chalk.dim(`\n  Branch: crew/${jobId}\n  Merge with: git merge crew/${jobId}`),
          );
        } else if (branchPreserved && doMerge && deleteBranch) {
          clack.outro(chalk.green.bold('SUCCESS! Branch merged.'));
        } else if (branchPreserved && doMerge && !deleteBranch) {
          clack.outro(
            chalk.green.bold('SUCCESS!') +
              chalk.dim(
                `\n  Merge failed. Branch preserved: crew/${jobId}\n  Merge manually: git merge crew/${jobId}`,
              ),
          );
        } else {
          clack.outro(chalk.yellow(`Did not reach APPROVED. Branch crew/${jobId} was discarded.`));
        }
      } else {
        sys.info(`Worktree preserved at: ${worktreePath} (branch: crew/${jobId})`);
      }
    } else {
      await runInteractiveSession({ initialGoal: goal, cliOpts: opts, keepWorktree });
    }
  } catch (error) {
    sys.error('Iteration loop failed critically:');
    sys.error(String(error));

    if (!keepWorktree) {
      sys.info('Cleaning up worktree...');
      await cleanupWorktree(jobId, true);
    }

    throw error;
  }
}

const isMain =
  process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMain) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

/**
 * Post-approval skill discovery phase.
 *
 * After the Reviewer approves the work, this module runs a final assessment:
 * 1. The Reviewer (via its Coder sidecar) scans /.cursor/skills/ and /.cursor/rules/
 *    for existing skills matching the work just done.
 * 2. If no similar skill exists, checks existing open issues with label `skill-candidate`.
 *    If a relevant issue exists, returns existingIssueMatch (skip creating a duplicate).
 * 3. If no similar skill and no relevant existing issue, returns suggestedIssue for creation.
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */

import { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';

import type { CodebaseBackend } from '../lib/codebase-backend/index.js';
import { CODEBASE_BACKEND_CONTEXT_KEY, readCodebaseTool } from '../mastra/tools/codebase.js';
import { smartModel } from '../models.js';
import { getDiff } from '../utils/git-worktree.js';
import { type DrainableChunk, drainFullStream } from './utils/drain-stream.js';
import type { ReviewerMemory, WorkerMemory } from './utils/iteration-loop.js';

/**
 * Zod schema for the Skill Discovery agent's structured output.
 */
export const SkillDiscoveryResultSchema = z.object({
  /** True if a similar skill already exists in .cursor/skills/ or .cursor/rules/ */
  skillExists: z.boolean(),
  /** Path to the existing skill, e.g. ".cursor/skills/act/dev-changelog/SKILL.md" (when skillExists is true) */
  existingSkillPath: z.string().optional(),
  /** When a relevant open issue with label skill-candidate already exists; skip creating a new one */
  existingIssueMatch: z
    .object({
      number: z.number(),
      url: z.string(),
    })
    .optional(),
  /** Brief reasoning for the assessment */
  reasoning: z.string(),
  /** Suggested GitHub issue content when skillExists is false and no existingIssueMatch */
  suggestedIssue: z
    .object({
      title: z.string(),
      body: z.string(),
    })
    .optional(),
});
export type SkillDiscoveryResult = z.infer<typeof SkillDiscoveryResultSchema>;

/** Shape of an issue from `gh issue list --json number,title,body,url` */
export interface SkillCandidateIssue {
  number: number;
  title: string;
  body: string;
  url: string;
}

export interface RunSkillDiscoveryOptions {
  /** The original goal that initiated the work */
  goal: string;
  /** Path to the isolated git worktree */
  worktreePath: string;
  /** Worker memory (reports, resolutions) */
  workerMemory: WorkerMemory;
  /** Reviewer memory (feedback log) */
  reviewerMemory: ReviewerMemory;
  /** Existing open issues with label skill-candidate (from gh issue list); used to avoid duplicates */
  existingSkillCandidateIssues?: SkillCandidateIssue[];
  /** Base branch for diff (default: main) */
  baseBranch?: string;
  /** Read-only codebase backend for scanning .cursor/skills/ and .cursor/rules/ */
  codebaseBackend: CodebaseBackend;
  /** Called with each text/reasoning delta from the LLM */
  onThought?: (delta: string) => void;
  /** Called with every fullStream chunk */
  onEvent?: (chunk: DrainableChunk) => void;
  /** Abort signal to cancel the in-flight LLM call */
  abortSignal?: AbortSignal;
}

/**
 * Runs the post-approval skill discovery phase.
 *
 * The agent scans .cursor/skills/ and .cursor/rules/ for existing skills that
 * match the work just done. If none found, it produces a suggested GitHub
 * issue with the required content (code changes, reviewer feedback, worker
 * steps, context).
 */
export async function runSkillDiscovery(
  options: RunSkillDiscoveryOptions,
): Promise<SkillDiscoveryResult> {
  const {
    goal,
    worktreePath,
    workerMemory,
    reviewerMemory,
    existingSkillCandidateIssues = [],
    baseBranch = 'main',
    codebaseBackend,
    onThought,
    onEvent,
    abortSignal,
  } = options;

  const diff = await getDiff(worktreePath, baseBranch);
  const fileList = extractFileListFromDiff(diff);

  const summarizedFeedback = reviewerMemory.feedbackLog
    .map(
      (entry) =>
        `Round ${entry.round}: ${JSON.stringify(entry.issues, null, 2)}${entry.workerSummary ? `\n  Worker summary: ${entry.workerSummary}` : ''}`,
    )
    .join('\n');

  const stepsLog = workerMemory.allResolutions.flatMap((r) => r.report.stepsLog).join('\n');

  const agent = new Agent({
    name: 'SkillDiscovery',
    instructions:
      'You are the Reviewer doing a final assessment after approving code. ' +
      'Your job is to check if the work just done corresponds to an existing skill or an existing skill-candidate issue. ' +
      'Use the readCodebase tool to scan .cursor/skills/ and .cursor/rules/ — list directories, ' +
      'read SKILL.md files, and compare descriptions to the work summarized below. ' +
      'If you find a skill that already covers this pattern, set skillExists to true and provide existingSkillPath. ' +
      'If no similar skill exists, check the provided list of existing open issues with label skill-candidate. ' +
      "If one of those issues is relevant to this work (same pattern, same intent), set existingIssueMatch with that issue's number and url — do NOT set suggestedIssue. " +
      'Only if no similar skill AND no relevant existing issue exists, set skillExists to false and provide suggestedIssue with: ' +
      '  - title: concise GitHub issue title for a new skill candidate ' +
      '  - body: markdown containing: (1) Files changed (from the diff), (2) Summarized Reviewer feedback, ' +
      '    (3) Summarized Worker steps log, (4) Context: original goal and why this work was initiated. ' +
      'Always provide reasoning for your assessment.',
    model: smartModel,
    tools: { readCodebase: readCodebaseTool },
  });

  const requestContext = new RequestContext<{ [CODEBASE_BACKEND_CONTEXT_KEY]: CodebaseBackend }>();
  requestContext.set(CODEBASE_BACKEND_CONTEXT_KEY, codebaseBackend);

  const existingIssuesSection =
    existingSkillCandidateIssues.length > 0
      ? `

Existing open issues with label skill-candidate:
${JSON.stringify(existingSkillCandidateIssues, null, 2)}

If any of these issues describe the same pattern/work as below, set existingIssueMatch (number, url) and do NOT create suggestedIssue.
`
      : '';

  const prompt = `
Original goal: ${goal}

Files changed (from worktree diff):
${fileList}

Summarized Reviewer feedback (all rounds):
${summarizedFeedback}

Summarized Worker steps log:
${stepsLog}
${existingIssuesSection}
Scan .cursor/skills/ and .cursor/rules/ for existing skills that match this work.
If found, set skillExists true and existingSkillPath.
Else check existing skill-candidate issues above; if one matches, set existingIssueMatch.
Else set skillExists false and suggestedIssue.
  `;

  const output = await agent.stream([{ role: 'user', content: prompt }], {
    structuredOutput: { schema: SkillDiscoveryResultSchema },
    requestContext,
    ...(abortSignal ? { abortSignal } : {}),
  });

  const [result] = await Promise.all([
    output.object,
    drainFullStream(output.fullStream as ReadableStream<DrainableChunk>, {
      onThought,
      onEvent,
    }),
  ]);

  if (result == null) {
    throw new DOMException('Skill discovery stream was aborted.', 'AbortError');
  }

  return result as SkillDiscoveryResult;
}

/** Extracts a simple list of changed file paths from a git diff. */
function extractFileListFromDiff(diff: string): string[] {
  const seen = new Set<string>();
  const lines = diff.split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\//);
      if (match) seen.add(match[1]);
    }
  }
  return Array.from(seen);
}

/**
 * PRD Review Committee – Mastra workflow with parallel reviewer agents.
 *
 * Architects, PM, Security, User Advocate review in parallel; synthesizer produces
 * refined PRD and outstanding questions.
 *
 * Model registry: src/models.ts (fastModel, smartModel).
 */

import { readFile, writeFile } from 'node:fs/promises';

import { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { fastModel, smartModel } from '../../models.js';

// --- ZOD CONTRACT ---

export const RefinedPRDSchema = z.object({
  updated_prd_content: z
    .string()
    .describe('The complete, fully rewritten PRD incorporating all accepted feedback.'),
  outstanding_questions: z
    .array(z.string())
    .describe('Critical unresolved questions requiring human input.'),
});

export type RefinedPRD = z.infer<typeof RefinedPRDSchema>;

// --- AGENTS ---

const architectAgent = new Agent({
  id: 'architect-agent',
  name: 'Architect',
  instructions: `You are a Principal Software Architect. Goal: Identify technical bottlenecks, scalability issues, and systemic flaws in product proposals. Background: You are a veteran engineer who has seen too many projects fail due to poor early architectural planning. You are highly critical of vague technical requirements.`,
  model: smartModel,
});

const pmAgent = new Agent({
  id: 'pm-agent',
  name: 'Project Manager',
  instructions: `You are a Senior Project Manager. Goal: Ensure scope is realistic, timelines are achievable, and business objectives are clearly met. Background: You are ruthlessly pragmatic. You hate scope creep and aggressively look for missing edge cases or unstated dependencies that will delay delivery.`,
  model: fastModel,
});

const securityAgent = new Agent({
  id: 'security-agent',
  name: 'Security Analyst',
  instructions: `You are a Lead Security Analyst. Goal: Identify threat vectors, data privacy risks, and compliance vulnerabilities. Background: You are a paranoid but brilliant security expert. You assume everything will be hacked and look for flaws in auth, data storage, and third-party integrations.`,
  model: smartModel,
});

const userAdvocateAgent = new Agent({
  id: 'user-advocate-agent',
  name: 'End User Advocate',
  instructions: `You are an End User Advocate. Goal: Ensure the product is intuitive, accessible, and solves an actual user problem. Background: You represent the customer. You have zero tolerance for tech-jargon or features that add complexity without adding user value.`,
  model: fastModel,
});

const synthesizerAgent = new Agent({
  id: 'synthesizer-agent',
  name: 'Tech Writer',
  instructions: `You are a Lead Technical Writer. Goal: Merge diverse feedback into a single, cohesive, and professional Product Requirements Document. Background: You are a master at taking messy, conflicting feedback from different stakeholders and turning it into a clear, actionable document.`,
  model: smartModel,
});

// --- SCHEMAS ---

const ReviewInput = z.object({ prd_document: z.string() });
const ReviewOutput = z.object({ critique: z.string() });

// --- PARALLEL REVIEW STEPS ---

const architectStep = createStep({
  id: 'architect-review',
  inputSchema: ReviewInput,
  outputSchema: ReviewOutput,
  execute: async ({ inputData }) => {
    const res = await architectAgent.generate([
      {
        role: 'user',
        content:
          `Review the following PRD for technical bottlenecks, scalability ` +
          `issues, and systemic flaws. Produce a markdown critique.\n\n${inputData.prd_document}`,
      },
    ]);
    return { critique: res.text };
  },
});

const pmStep = createStep({
  id: 'pm-review',
  inputSchema: ReviewInput,
  outputSchema: ReviewOutput,
  execute: async ({ inputData }) => {
    const res = await pmAgent.generate([
      {
        role: 'user',
        content: `Review the following PRD for scope, timelines, and business logic gaps. Produce a markdown critique.\n\n${inputData.prd_document}`,
      },
    ]);
    return { critique: res.text };
  },
});

const securityStep = createStep({
  id: 'security-review',
  inputSchema: ReviewInput,
  outputSchema: ReviewOutput,
  execute: async ({ inputData }) => {
    const res = await securityAgent.generate([
      {
        role: 'user',
        content: `Review the following PRD for threat vectors, privacy risks, and compliance vulnerabilities. Produce a markdown critique.\n\n${inputData.prd_document}`,
      },
    ]);
    return { critique: res.text };
  },
});

const userAdvocateStep = createStep({
  id: 'user-advocate-review',
  inputSchema: ReviewInput,
  outputSchema: ReviewOutput,
  execute: async ({ inputData }) => {
    const res = await userAdvocateAgent.generate([
      {
        role: 'user',
        content: `Review the following PRD for UX, accessibility, and actual user value. Produce a markdown critique.\n\n${inputData.prd_document}`,
      },
    ]);
    return { critique: res.text };
  },
});

// --- REWRITE STEP ---

const rewriteStep = createStep({
  id: 'rewrite',
  inputSchema: z.object({ prd_document: z.string(), critiques: z.string() }),
  outputSchema: RefinedPRDSchema,
  execute: async ({ inputData }) => {
    const res = await synthesizerAgent.generate(
      [
        {
          role: 'user',
          content: `Original PRD:\n\n${inputData.prd_document}\n\n---\n\nCritiques from the review committee:\n\n${inputData.critiques}\n\n---\n\nRewrite the PRD to address all resolvable flaws and incorporate the improvements. If the reviewers raised questions that cannot be solved without external input, extract those as outstanding questions.`,
        },
      ],
      {
        structuredOutput: {
          schema: RefinedPRDSchema,
        },
      },
    );
    return res.object as RefinedPRD;
  },
});

// --- WORKFLOW ---

export const prdReviewWorkflow = createWorkflow({
  id: 'prd-review-workflow',
  inputSchema: z.object({ prd_document: z.string() }),
  outputSchema: RefinedPRDSchema,
})
  .parallel([architectStep, pmStep, securityStep, userAdvocateStep])
  .map(async ({ inputData, getInitData }) => {
    const init = getInitData<{ prd_document: string }>();
    const critiques = [
      `## Architect\n${inputData['architect-review'].critique}`,
      `## Project Manager\n${inputData['pm-review'].critique}`,
      `## Security\n${inputData['security-review'].critique}`,
      `## User Advocate\n${inputData['user-advocate-review'].critique}`,
    ].join('\n\n---\n\n');
    return { prd_document: init.prd_document, critiques };
  })
  .then(rewriteStep)
  .commit();

// --- RUNNER ---

/** Example PRD format — used with --demo. */
export const DEMO_PRD = `
# Feature: Tiny wrapper scripts for safe gh subcommands

## Summary

Cursor's allowlist recognizes commands at the root level (e.g. gh), not subcommands.
Allowing gh broadly is dangerous because it would also permit "gh repo delete".
Requiring approval for safe commands like "gh issue view" every time is friction.

## Solution

Create tiny wrapper scripts such as "gh_issue_view" that only invoke the safe subcommand,
then add "gh_issue_view" (and similar) to the allowlist instead of "gh".
Dangerous commands stay blocked since they have no wrapper.
`.trim();

/**
 * Options for the PRD review workflow.
 */
export interface PrdReviewOptions {
  inputPath: string;
  outputPath: string;
  demo?: boolean;
}

function formatOutput(result: RefinedPRD): string {
  let out = result.updated_prd_content;
  if (result.outstanding_questions.length > 0) {
    out += '\n\n---\n\n## Outstanding questions\n\n';
    out += result.outstanding_questions.map((q) => `- ${q}`).join('\n');
  }
  return out;
}

/** Run PRD review: read input, run workflow, write output to file. */
export async function runPrdReview(options: PrdReviewOptions): Promise<RefinedPRD> {
  const prdDocument = options.demo ? DEMO_PRD : await readFile(options.inputPath, 'utf-8');

  const run = await prdReviewWorkflow.createRun();
  const result = await run.start({
    inputData: { prd_document: prdDocument },
  });

  if (result.status !== 'success') {
    throw new Error(`Workflow did not finish: ${result.status}`);
  }

  const refined = result.result as RefinedPRD;
  if (typeof refined !== 'object' || !('updated_prd_content' in refined)) {
    throw new Error('Unexpected result shape');
  }

  const formatted = formatOutput(refined);
  await writeFile(options.outputPath, formatted, 'utf-8');

  return refined;
}

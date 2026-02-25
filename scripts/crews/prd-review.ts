#!/usr/bin/env node
/**
 * PRD Review Committee – CrewAI-style workflow via KaibanJS.
 *
 * Usage:
 *   pnpm run crew-prd-review <input-path> <output-path>
 *   pnpm run crew-prd-review --demo <output-path>  # use DEMO_PRD as input (example format)
 *
 * Requires OPENAI_API_KEY (or CREW_MODEL_*_API_KEY). Config: scripts/crews/config.ts.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";
import { Agent, Task, Team } from "kaibanjs";

import { fastLlm, smartLlm } from "./config.js";

// --- ZOD CONTRACT ---

const RefinedPRDSchema = z.object({
  updated_prd_content: z.string().describe("The complete, fully rewritten PRD incorporating all accepted feedback."),
  outstanding_questions: z.array(z.string()).describe("Critical unresolved questions requiring human input."),
});

type RefinedPRD = z.infer<typeof RefinedPRDSchema>;

// --- AGENTS ---

const architect = new Agent({
  name: "Architect",
  role: "Principal Software Architect",
  goal: "Identify technical bottlenecks, scalability issues, and systemic flaws in product proposals.",
  background:
    "You are a veteran engineer who has seen too many projects fail due to poor early architectural planning. You are highly critical of vague technical requirements.",
  ...smartLlm,
});

const pm = new Agent({
  name: "Project Manager",
  role: "Senior Project Manager",
  goal: "Ensure scope is realistic, timelines are achievable, and business objectives are clearly met.",
  background:
    "You are ruthlessly pragmatic. You hate scope creep and aggressively look for missing edge cases or unstated dependencies that will delay delivery.",
  ...fastLlm,
});

const security = new Agent({
  name: "Security Analyst",
  role: "Lead Security Analyst",
  goal: "Identify threat vectors, data privacy risks, and compliance vulnerabilities.",
  background:
    "You are a paranoid but brilliant security expert. You assume everything will be hacked and look for flaws in auth, data storage, and third-party integrations.",
  ...smartLlm,
});

const userAdvocate = new Agent({
  name: "End User Advocate",
  role: "End User Advocate",
  goal: "Ensure the product is intuitive, accessible, and solves an actual user problem.",
  background:
    "You represent the customer. You have zero tolerance for tech-jargon or features that add complexity without adding user value.",
  ...fastLlm,
});

const synthesizer = new Agent({
  name: "Tech Writer",
  role: "Lead Technical Writer",
  goal: "Merge diverse feedback into a single, cohesive, and professional Product Requirements Document.",
  background:
    "You are a master at taking messy, conflicting feedback from different stakeholders and turning it into a clear, actionable document.",
  ...smartLlm,
});

// --- TASKS ---

const reviewTask = new Task({
  description: `Review the following PRD draft:

{prd_document}

From each perspective:
1. Architect: Analyze for technical feasibility, scalability, and systemic flaws.
2. PM: Analyze for scope, timelines, and business logic gaps.
3. Security: Analyze for vulnerabilities, privacy risks, and compliance.
4. User Advocate: Analyze for UX, accessibility, and actual user value.

Debate the flaws. Do NOT rewrite the document yet. Produce a comprehensive markdown list of critiques, required changes, and unresolved questions.`,
  expectedOutput: "A detailed markdown list of critiques, grouped by agent perspective.",
  agent: pm,
});

const rewriteTask = new Task({
  description: `Original PRD:
{prd_document}

Critiques from the review committee:
{taskResult:task1}

Take the original PRD and the comprehensive critiques above. Rewrite the PRD to address all resolvable flaws and incorporate the improvements.

If the agents raised questions that cannot be solved without external input (e.g., missing budget, unknown third-party API limits), extract those as outstanding questions.`,
  expectedOutput: "A fully refined PRD and a list of outstanding questions.",
  agent: synthesizer,
  outputSchema: RefinedPRDSchema,
});

// --- TEAM ---

export const prdReviewTeam = new Team({
  name: "PRD Review Committee",
  agents: [architect, pm, security, userAdvocate, synthesizer],
  tasks: [reviewTask, rewriteTask],
  memory: true,
  env: { ...process.env } as Record<string, string>,
});

// --- RUNNER ---

/** Example PRD format — used with --demo to illustrate expected input structure. */
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

export interface PrdReviewOptions {
  inputPath: string;
  outputPath: string;
  demo?: boolean;
}

function parseArgs(args: string[]): PrdReviewOptions | null {
  let demo = false;
  const paths: string[] = [];
  for (const a of args) {
    if (a === "--demo") demo = true;
    else if (!a.startsWith("-")) paths.push(a);
  }
  if (demo) {
    if (paths.length !== 1) return null;
    return { inputPath: "", outputPath: paths[0]!, demo: true };
  }
  if (paths.length !== 2) return null;
  return { inputPath: paths[0]!, outputPath: paths[1]!, demo: false };
}

function formatOutput(result: RefinedPRD): string {
  let out = result.updated_prd_content;
  if (result.outstanding_questions.length > 0) {
    out += "\n\n---\n\n## Outstanding questions\n\n";
    out += result.outstanding_questions.map((q) => `- ${q}`).join("\n");
  }
  return out;
}

/** Run PRD review: read input, run crew, write output to file. */
export async function runPrdReview(options: PrdReviewOptions): Promise<RefinedPRD> {
  const prdDocument = options.demo ? DEMO_PRD : await readFile(options.inputPath, "utf-8");

  const output = await prdReviewTeam.start({ prd_document: prdDocument });

  if (output.status !== "FINISHED") {
    throw new Error(`Workflow did not finish: ${output.status}`);
  }

  const result = output.result as RefinedPRD | string;
  if (typeof result !== "object" || !("updated_prd_content" in result)) {
    throw new Error("Unexpected result shape");
  }

  const formatted = formatOutput(result);
  await writeFile(options.outputPath, formatted, "utf-8");

  return result;
}

function printUsage(): void {
  console.error(`Usage:
  pnpm run crew-prd-review <input-path> <output-path>
  pnpm run crew-prd-review --demo <output-path>

  --demo  Use DEMO_PRD (example format) as input instead of reading a file.`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    printUsage();
    process.exit(1);
  }

  console.log("Starting PRD review committee...\n");

  const result = await runPrdReview(opts);

  console.log(`Wrote: ${opts.outputPath}`);
  console.log(`  - Refined PRD: ${result.updated_prd_content.length} chars`);
  console.log(`  - Outstanding questions: ${result.outstanding_questions.length}`);
}

const isMain =
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

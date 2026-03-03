#!/usr/bin/env node
/**
 * PRD Review Committee – CLI runner.
 *
 * Thin wrapper around the Mastra workflow in src/mastra/workflows/prd-review.ts.
 *
 * Usage:
 *   pnpm run demo-prd-review <input-path> <output-path>
 *   pnpm run demo-prd-review --demo <output-path>
 *
 * Requires OPENAI_API_KEY (or CREW_MODEL_*_API_KEY). Config: src/models.ts.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type PrdReviewOptions, runPrdReview } from '../src/mastra/workflows/demo-prd-review.js';

function parseArgs(args: string[]): PrdReviewOptions | null {
  let demo = false;
  const paths: string[] = [];
  for (const a of args) {
    if (a === '--demo') demo = true;
    else if (!a.startsWith('-')) paths.push(a);
  }
  if (demo) {
    if (paths.length !== 1) return null;
    return { inputPath: '', outputPath: paths[0]!, demo: true };
  }
  if (paths.length !== 2) return null;
  return { inputPath: paths[0]!, outputPath: paths[1]!, demo: false };
}

function printUsage(): void {
  console.error(`Usage:
  pnpm run demo-prd-review <input-path> <output-path>
  pnpm run demo-prd-review --demo <output-path>

  --demo  Use DEMO_PRD (example format) as input instead of reading a file.`);
}

export async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    printUsage();
    process.exit(1);
  }

  console.log('Starting PRD review committee...\n');

  const result = await runPrdReview(opts);

  console.log(`Wrote: ${opts.outputPath}`);
  console.log(`  - Refined PRD: ${result.updated_prd_content.length} chars`);
  console.log(`  - Outstanding questions: ${result.outstanding_questions.length}`);
}

// When run directly (tsx src/crews/prd-review.ts), execute main
const isMain =
  process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]!);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

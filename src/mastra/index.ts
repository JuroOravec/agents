/**
 * Central Mastra instance for AI crews.
 *
 * Registers all workflows and agents. Use mastra.getWorkflow("prdReview") to run
 * the PRD review committee from other scripts or the Mastra Studio.
 */

import { Mastra } from '@mastra/core';

import { reviewerAgent } from './agents/reviewer.js';
import { workerAgent } from './agents/worker.js';
import { editCodebaseTool, readCodebaseTool } from './tools/codebase.js';
import { prdReviewWorkflow } from './workflows/prd-review.js';

export const mastra = new Mastra({
  agents: {
    workerAgent,
    reviewerAgent,
  },
  workflows: {
    prdReview: prdReviewWorkflow,
  },
  tools: {
    readCodebase: readCodebaseTool,
    editCodebase: editCodebaseTool,
  },
});

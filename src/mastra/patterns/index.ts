/**
 * Multi-Agent Collaboration Pattern Library
 *
 * Reusable building blocks for Mastra workflows. Each pattern module exports a
 * create*Workflow function that returns a committed Mastra workflow. Use these
 * for PRD review, committee discussion, routing, batch processing, and more.
 *
 * @example
 * import { createFanOutWorkflow } from "./mastra/patterns/fanOut.js";
 * import { createPipeWorkflow } from "./mastra/patterns/pipe.js";
 *
 * const prdWorkflow = createFanOutWorkflow({
 *   workflowId: "prd-review",
 *   inputSchema: z.object({ document: z.string() }),
 *   artifactKey: "document",
 *   reviewers: [...],
 *   synthesizer: synthAgent,
 *   outputSchema: z.object({ summary: z.string() }),
 *   synthesizerPromptTemplate: "...",
 * });
 *
 * See docs/features/ai-crews/patterns.md for the full catalog.
 */

export * from './branching.js';
export * from './competeTournamentBracket.js';
export * from './doWhile.js';
export * from './evaluatorOptimizer.js';
export * from './fanOut.js';
export * from './fanOutAdversarial.js';
export * from './fanOutSelective.js';
export * from './fanOutWeightedPanel.js';
export * from './humanInTheLoopGate.js';
export * from './mapThenReduce.js';
export * from './orchestrator.js';
export * from './pipe.js';
export * from './retry.js';
export * from './roundRobin.js';
export * from './roundRobinWithReplies.js';
export * from './router.js';
export * from './selfCorrection.js';
export * from './sidecar.js';
export * from './while.js';

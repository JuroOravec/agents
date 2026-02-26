/**
 * Reflection / Self-Correction (Single Agent) pattern.
 *
 * One agent runs three steps: generate (initial draft), critique (review own output),
 * revise (incorporate critique into final version). No multi-agent coordination,
 * the same agent acts as author and critic. Good for improving quality
 * of single-agent outputs without adding more agents.
 *
 * ```
 * Input ── Generate ── Critique(self) ── Revise ── Output
 * ```
 *
 * @example
 * const workflow = createSelfCorrectionWorkflow({
 *   workflowId: "self-correction",
 *   inputSchema: z.object({ prompt: z.string() }),
 *   inputKey: "prompt",
 *   agent: writerAgent,
 *   generatePromptTemplate: "Write a draft: {input}",
 *   critiquePromptTemplate: "Critique this draft. Input: {input}\nDraft: {draft}",
 *   revisePromptTemplate: "Revise based on critique. Input: {input}\nDraft: {draft}\nCritique: {critique}",
 *   outputSchema: z.object({ final: z.string() }),
 * });
 *
 * See docs/features/ai-crews/patterns.md#14-reflection--self-correction
 */

import type { Agent } from '@mastra/core/agent';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export interface SelfCorrectionOptions<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  workflowId: string;
  inputSchema: TInput;
  inputKey: string;
  agent: Agent;
  generatePromptTemplate: string;
  critiquePromptTemplate: string;
  revisePromptTemplate: string;
  outputSchema: TOutput;
}

export function createSelfCorrectionWorkflow<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(options: SelfCorrectionOptions<TInput, TOutput>) {
  const {
    workflowId,
    inputSchema,
    inputKey,
    agent,
    generatePromptTemplate,
    critiquePromptTemplate,
    revisePromptTemplate,
    outputSchema,
  } = options;

  const generateStep = createStep({
    id: 'generate',
    inputSchema: z.object({ input: z.string() }),
    outputSchema: z.object({ draft: z.string() }),
    execute: async ({ inputData }) => {
      const input = (inputData as { input: string }).input;
      const prompt = generatePromptTemplate.replace('{input}', input);
      const res = await agent.generate([{ role: 'user', content: prompt }]);
      return { draft: res.text };
    },
  });

  const critiqueStep = createStep({
    id: 'critique',
    inputSchema: z.object({ draft: z.string(), input: z.string() }),
    outputSchema: z.object({ draft: z.string(), critique: z.string(), input: z.string() }),
    execute: async ({ inputData }) => {
      const { draft, input } = inputData as { draft: string; input: string };
      const prompt = critiquePromptTemplate.replace('{input}', input).replace('{draft}', draft);
      const res = await agent.generate([{ role: 'user', content: prompt }]);
      return { draft, critique: res.text, input };
    },
  });

  const reviseStep = createStep({
    id: 'revise',
    inputSchema: z.object({ draft: z.string(), critique: z.string(), input: z.string() }),
    outputSchema: outputSchema as z.ZodTypeAny,
    execute: async ({ inputData }) => {
      const { draft, critique, input } = inputData as {
        draft: string;
        critique: string;
        input: string;
      };
      const prompt = revisePromptTemplate
        .replace('{input}', input)
        .replace('{draft}', draft)
        .replace('{critique}', critique);
      const res = await agent.generate([{ role: 'user', content: prompt }], {
        structuredOutput: { schema: outputSchema },
      });
      return res.object;
    },
  });

  const initStep = createStep({
    id: 'init',
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.object({ input: z.string() }),
    execute: async ({ inputData }) => {
      const init = inputData as Record<string, unknown>;
      return { input: String(init[inputKey] ?? '') };
    },
  });

  return createWorkflow({
    id: workflowId,
    inputSchema: inputSchema as z.ZodTypeAny,
    outputSchema: outputSchema as z.ZodTypeAny,
  })
    .then(initStep)
    .then(generateStep)
    .map(async ({ inputData, getInitData }) => {
      const init = getInitData<Record<string, string>>();
      const draft = (inputData as { draft: string }).draft;
      return { draft, input: init[inputKey] ?? '' };
    })
    .then(critiqueStep)
    .then(reviseStep)
    .commit();
}

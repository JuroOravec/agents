/**
 * Tests for the Human-in-the-Loop Gate pattern.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createHumanInTheLoopGateWorkflow } from './humanInTheLoopGate.js';
import { createMockStep } from './__tests__/utils.js';

const InputSchema = z.object({ draft: z.string() });
const OutputSchema = z.object({ final: z.string() });

describe('createHumanInTheLoopGateWorkflow', () => {
  it('runs beforeStep, gateStep, and afterStep in sequence', async () => {
    const { step: beforeStep, executeSpy: beforeSpy } = createMockStep({
      id: 'before',
      output: { prepared: 'ready' },
    });
    const { step: gateStep, executeSpy: gateSpy } = createMockStep({
      id: 'gate',
      output: { approved: true },
    });
    const { step: afterStep, executeSpy: afterSpy } = createMockStep({
      id: 'after',
      output: { final: 'approved-output' },
    });

    const workflow = createHumanInTheLoopGateWorkflow({
      workflowId: 'human-gate',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      beforeStep,
      gateStep,
      afterStep,
    });

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { draft: 'initial draft' } });

    expect(result.status).toBe('success');
    expect(beforeSpy).toHaveBeenCalledTimes(1);
    expect(gateSpy).toHaveBeenCalledTimes(1);
    expect(afterSpy).toHaveBeenCalledTimes(1);

    const output = (result as { result?: { final?: string } }).result;
    expect(output?.final).toBe('approved-output');
  });
});

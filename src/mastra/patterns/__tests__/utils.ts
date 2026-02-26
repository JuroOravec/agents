/**
 * Test utilities for Mastra pattern tests.
 *
 * Provides mock Steps and Agents to verify workflow control flow without
 * invoking real LLMs.
 */

import { createStep } from '@mastra/core/workflows';
import { vi } from 'vitest';
import { z } from 'zod';

/** Schema for arbitrary step input/output in tests */
const AnySchema = z.any();

export interface MockStepResult {
  step: ReturnType<typeof createStep>;
  executeSpy: ReturnType<typeof vi.fn>;
}

export interface CreateMockStepOptions<T = unknown> {
  id: string;
  output: T;
  inputSchema?: z.ZodTypeAny;
  outputSchema?: z.ZodTypeAny;
}

/**
 * Creates a Mastra step with a spy on its execute function.
 * Returns both the step and the spy so tests can assert on invocations.
 */
export function createMockStep<T = unknown>(opts: CreateMockStepOptions<T>): MockStepResult {
  const { id, output, inputSchema = AnySchema, outputSchema = AnySchema } = opts;
  const executeSpy = vi.fn().mockImplementation(async (_params: { inputData: unknown }) => output);
  const step = createStep({
    id,
    inputSchema,
    outputSchema,
    execute: executeSpy as (params: { inputData: unknown }) => Promise<T>,
  });
  return { step, executeSpy };
}

/**
 * Shape of the object returned by Agent.generate() when using structuredOutput.
 */
export interface MockAgentGenerateResult {
  text: string;
  object: unknown;
}

/**
 * Creates a mock Agent-like object for use in workflow tests.
 * Use with vi.mock('@mastra/core/agent') or pass as agent dependency
 * when the pattern accepts an Agent instance.
 */
export function createMockAgentResponses(
  generateText = 'Mocked agent response',
  generateObject: unknown = { result: 'Mocked structured output' },
): MockAgentGenerateResult {
  return { text: generateText, object: generateObject };
}

/**
 * Creates a mock Agent constructor implementation for vi.mock.
 * Each call to new Agent() returns an instance with generate/stream that resolve
 * to the given response.
 */
export function createMockAgentImplementation(
  response: MockAgentGenerateResult = createMockAgentResponses(),
) {
  return vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue(response),
    stream: vi.fn().mockResolvedValue({
      object: Promise.resolve(response.object),
      fullStream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-delta', payload: { text: response.text } });
          controller.close();
        },
      }),
    }),
  }));
}

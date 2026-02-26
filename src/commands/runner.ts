/**
 * Command runner — parses args with the command's options config and invokes the handler.
 */

import { parseArgs } from 'node:util';

import type { CommandDef, ParseArgsResult } from './types.js';

/**
 * Run a command definition with the given args.
 * Handles --help by printing usage and exiting 0.
 * Parses args, then calls the handler with { values, positionals }.
 * Strips a leading "--" (end-of-options separator from npm/pnpm run).
 */
export async function runCommand(
  def: CommandDef,
  args: readonly string[],
): Promise<void> {
  const filtered = args[0] === '--' ? args.slice(1) : args;
  const config = {
    args: [...filtered],
    options: def.options,
    strict: false,
    allowPositionals: true,
    ...def.parseArgsOverrides,
  };

  const parsed = parseArgs(config) as ParseArgsResult & {
    values: { help?: boolean };
  };

  if (parsed.values.help) {
    console.log(`${def.description}\n\n${def.usage}`);
    process.exit(0);
  }

  await def.handler(parsed);
}

#!/usr/bin/env node
/**
 * CLI entrypoint — routes to command definitions in scripts/.
 *
 * Usage: tsx src/commands/cli.ts <command> [options...]
 * Example: tsx src/commands/cli.ts preview -p 3040
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getRepoRoot } from '../constants.js';
import { runCommand } from './runner.js';
import type { CommandDef } from './types.js';

const commandsDir = join(getRepoRoot(), 'scripts', 'commands');

async function discoverCommands(): Promise<Map<string, CommandDef>> {
  const files = await readdir(commandsDir);
  const tsFiles = files.filter((f) => f.endsWith('.ts')).sort();
  const commands = new Map<string, CommandDef>();

  for (const file of tsFiles) {
    const name = file.replace(/\.ts$/, '');
    const url = pathToFileURL(join(commandsDir, file)).href;
    const mod = (await import(url)) as { default?: unknown };
    const def = mod.default;
    if (!def || typeof def !== 'object') continue;
    const obj = def as Record<string, unknown>;
    if (typeof obj.handler !== 'function') continue;
    commands.set(name, def as CommandDef);
  }

  return commands;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const commandName = args[0];
  const restArgs = args.slice(1);

  const commands = await discoverCommands();

  if (!commandName || commandName === '-h' || commandName === '--help') {
    console.log(`Usage: tsx src/commands/cli.ts <command> [options]

Commands:`);
    for (const [name, def] of commands) {
      console.log(`  ${name.padEnd(16)} ${def.description}`);
    }
    console.log(`
Run 'tsx src/commands/cli.ts <command> --help' for command-specific options.`);
    process.exit(0);
  }

  const def = commands.get(commandName);
  if (!def) {
    console.error(`Unknown command: ${commandName}`);
    console.error(`Available: ${[...commands.keys()].join(', ')}`);
    process.exit(1);
  }

  try {
    await runCommand(def, restArgs);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(e.message);
    // AI SDK AI_APICallError exposes statusCode and responseBody — surface them for debugging
    const providerErr = (e.cause && typeof e.cause === 'object' ? e.cause : e) as {
      statusCode?: number;
      responseBody?: unknown;
      message?: string;
      stack?: string;
    };
    if (typeof providerErr.statusCode === 'number') {
      console.error(`\nHTTP ${providerErr.statusCode}`);
    }
    if (providerErr.responseBody != null) {
      const body =
        typeof providerErr.responseBody === 'string'
          ? providerErr.responseBody
          : JSON.stringify(providerErr.responseBody, null, 2);
      console.error('Response:', body.slice(0, 500) + (body.length > 500 ? '…' : ''));
    }
    if (e.cause && e.cause !== providerErr) {
      const cause = e.cause instanceof Error ? e.cause : new Error(String(e.cause));
      console.error('\nCause:', cause.message);
      if (cause.stack) console.error(cause.stack);
    } else if (e.stack) {
      console.error('\n' + e.stack);
    }
    process.exit(1);
  }
}

void main();

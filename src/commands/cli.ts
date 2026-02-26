#!/usr/bin/env node
/**
 * CLI entrypoint — routes to command definitions in scripts/.
 *
 * Usage: tsx src/commands/cli.ts <command> [options...]
 * Example: tsx src/commands/cli.ts preview -p 3040
 */

import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

import { runCommand } from './runner.js';
import type { CommandDef } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(dirname(__dirname));
const commandsDir = join(repoRoot, 'scripts', 'commands');

async function discoverCommands(): Promise<Map<string, CommandDef>> {
  const files = await readdir(commandsDir);
  const tsFiles = files.filter((f) => f.endsWith('.ts')).sort();
  const commands = new Map<string, CommandDef>();

  for (const file of tsFiles) {
    const name = file.replace(/\.ts$/, '');
    const url = pathToFileURL(join(commandsDir, file)).href;
    const mod = await import(url);
    const def = mod.default;
    if (!def || typeof def !== 'object' || typeof def.handler !== 'function') {
      continue;
    }
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
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();

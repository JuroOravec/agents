#!/usr/bin/env node
/**
 * Start the skill-eval dashboard server.
 * Usage: pnpm run preview
 *
 * Serves at http://localhost:3040 (configurable via -p).
 *
 * Pages: Skills (heatmap + line chart), Agents (subagent runs), Tools (tool invocations).
 */

import { resolve } from 'node:path';

import { startPreviewServer } from './server.js';

const args = process.argv.slice(2);
let port = 3040;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-p' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    break;
  }
}

const repoRoot = resolve(process.cwd());
await startPreviewServer({ port, repoRoot });

import { resolve } from 'node:path';

import type { CommandDef } from '../../src/commands/types.js';
import { startPreviewServer } from '../../src/preview/server.js';

const command: CommandDef = {
  name: 'preview',
  description: 'Start the skill-eval dashboard server',
  usage: `Usage: pnpm run preview [options]

Options:
  -p, --port <n>   Port to listen on (default: 3040)
  -h, --help       Show this help`,
  options: {
    port: { type: 'string', short: 'p' },
    help: { type: 'boolean', short: 'h' },
  },
  handler: async (parsed) => {
    const port = typeof parsed.values.port === 'string' ? parseInt(parsed.values.port, 10) : 3040;
    const repoRoot = resolve(process.cwd());
    await startPreviewServer({ port, repoRoot });
  },
};

export default command;

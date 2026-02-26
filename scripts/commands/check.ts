import type { CommandDef } from '../../src/commands/types.js';
import { runCheck } from '../../src/engine/index.js';

const command: CommandDef = {
  name: 'check',
  description:
    'Run the check pipeline: Types, Lint, Format, Unit Tests, Custom Constraints. Used by CI and for local verification.',
  usage: `Usage: npm run check [options]

Options:
  --reporter=agent   Output JSON status for agent consumption (PASSED/FAILED)
  -h, --help        Show this help`,
  options: {
    help: { type: 'boolean', short: 'h' },
    reporter: { type: 'string' },
  },
  handler: async (parsed) => {
    const reporter =
      typeof parsed.values.reporter === 'string' ? parsed.values.reporter : undefined;
    await runCheck({ reporter });
  },
};

export default command;

import type { CommandDef } from '../../src/commands/types.js';
import { runValidation } from '../../src/engine/validate/index.js';

const command: CommandDef = {
  name: 'validate',
  description:
    'Validation runner — discovers and runs all validation scripts in src/engine/validate/. Exits with code 1 if any script throws.',
  usage: `Usage: npm run validate [options]

Options:
  -h, --help    Show this help`,
  options: {
    help: { type: 'boolean', short: 'h' },
  },
  handler: async () => {
    await runValidation();
  },
};

export default command;

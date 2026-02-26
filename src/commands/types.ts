/**
 * Command definition for the unified CLI.
 * Each script in scripts/ exports a default CommandDef.
 */

import type { ParseArgsOptionsConfig } from 'node:util';

/** Result of parseArgs - values and positionals passed to the handler. */
export interface ParseArgsResult {
  values: Record<string, string | boolean | string[] | boolean[] | undefined>;
  positionals: string[];
}

/** Optional overrides for parseArgs config (strict, allowPositionals, allowNegative). */
export interface CommandParseArgsOverrides {
  strict?: boolean;
  allowPositionals?: boolean;
  allowNegative?: boolean;
  tokens?: boolean;
}

export interface CommandDef<TOptions extends ParseArgsOptionsConfig = ParseArgsOptionsConfig> {
  name: string;
  description: string;
  usage: string;
  options: TOptions;
  /** Override parseArgs config defaults. */
  parseArgsOverrides?: CommandParseArgsOverrides;
  /** Handler receives already-parsed values and positionals. */
  handler: (parsed: ParseArgsResult) => Promise<void>;
}

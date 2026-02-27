/**
 * Native filesystem and shell tools for the NativeCodebaseBackend.
 *
 * Each tool is scoped to a `worktreePath` to guarantee isolation — no tool can
 * read or write outside the provided directory.
 *
 * Read-only tools (safe for both ask and edit agents):
 *   readFile   — read a file's contents
 *   listDir    — list files/dirs in a directory
 *   searchCode — grep for a pattern across the worktree
 *
 * Write tools (edit agent only):
 *   writeFile  — overwrite or create a file
 *   runShell   — run a shell command inside the worktree (required for check:agent)
 *
 * @see {@link file://./specs/agents/worker/README.md Design Doc}
 */

import { exec } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const execAsync = promisify(exec);

// ─── Safety helper ─────────────────────────────────────────────────────────

/**
 * Resolves a relative path against the worktree root and asserts the result
 * stays inside the worktree (prevents `../` escape attacks).
 */
function safePath(worktreePath: string, relativePath: string): string {
  const resolved = path.resolve(worktreePath, relativePath);
  if (!resolved.startsWith(path.resolve(worktreePath))) {
    throw new Error(`Path escape attempt: "${relativePath}" is outside the worktree.`);
  }
  return resolved;
}

// ─── Read-only tools ───────────────────────────────────────────────────────

/**
 * Creates a tool that reads the contents of a file inside the worktree.
 *
 * @param worktreePath - The isolated git worktree the tool is scoped to.
 */
export function createReadFileTool(worktreePath: string) {
  return createTool({
    id: 'readFile',
    description: 'Read the contents of a file. Path is relative to the worktree root.',
    inputSchema: z.object({
      path: z.string().describe('File path relative to the worktree root.'),
    }),
    execute: async (args: Record<string, unknown>) => {
      const p = unwrapArgs(args);
      try {
        const filePath = safePath(worktreePath, p['path'] as string);
        return await fs.readFile(filePath, 'utf-8');
      } catch (err) {
        return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

/**
 * Creates a tool that lists files and directories in a given directory.
 *
 * @param worktreePath - The isolated git worktree the tool is scoped to.
 */
export function createListDirTool(worktreePath: string) {
  return createTool({
    id: 'listDir',
    description: 'List files and directories at a path. Path is relative to the worktree root.',
    inputSchema: z.object({
      path: z.string().default('.').describe('Directory path relative to the worktree root.'),
    }),
    execute: async (args: Record<string, unknown>) => {
      const p = unwrapArgs(args);
      try {
        const dirPath = safePath(worktreePath, (p['path'] as string | undefined) ?? '.');
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).join('\n');
      } catch (err) {
        return `Error listing directory: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

/**
 * Creates a tool that searches the worktree for a text pattern (using grep).
 *
 * @param worktreePath - The isolated git worktree the tool is scoped to.
 */
export function createSearchCodeTool(worktreePath: string) {
  return createTool({
    id: 'searchCode',
    description: 'Search for a pattern across the worktree using grep. Returns matching lines.',
    inputSchema: z.object({
      pattern: z.string().describe('The regex pattern to search for.'),
      glob: z
        .string()
        .optional()
        .describe('Optional glob to restrict which files are searched, e.g. "*.ts".'),
    }),
    execute: async (args: Record<string, unknown>) => {
      const p = unwrapArgs(args);
      const pattern = p['pattern'] as string;
      const glob = p['glob'] as string | undefined;
      const globArg = glob ? `--include="${glob}"` : '';
      try {
        const { stdout } = await execAsync(`grep -rn ${globArg} --with-filename "${pattern}" .`, {
          cwd: worktreePath,
        });
        return stdout.trim() || '(no matches)';
      } catch (err: unknown) {
        // grep exits with code 1 when there are no matches — not an error
        const execError = err as { code?: number; stderr?: string };
        if (execError.code === 1) return '(no matches)';
        return `Error searching: ${execError.stderr ?? String(err)}`;
      }
    },
  });
}

// ─── Write tools ───────────────────────────────────────────────────────────

/**
 * Creates a tool that writes (creates or overwrites) a file in the worktree.
 *
 * @param worktreePath - The isolated git worktree the tool is scoped to.
 */
export function createWriteFileTool(worktreePath: string) {
  return createTool({
    id: 'writeFile',
    description:
      'Write content to a file in the worktree, creating it if it does not exist. Path is relative to the worktree root.',
    inputSchema: z.object({
      path: z.string().describe('File path relative to the worktree root.'),
      content: z.string().describe('The full file content to write.'),
    }),
    execute: async (args: Record<string, unknown>) => {
      const p = unwrapArgs(args);
      try {
        const filePath = safePath(worktreePath, p['path'] as string);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, p['content'] as string, 'utf-8');
        return `Written: ${p['path']}`;
      } catch (err) {
        return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

/**
 * Creates a tool that runs a shell command inside the worktree.
 * Required for running `npm run check:agent` to validate changes.
 *
 * Commands are always executed with `cwd` set to the worktree root.
 *
 * @param worktreePath - The isolated git worktree the tool is scoped to.
 */
export function createRunShellTool(worktreePath: string) {
  return createTool({
    id: 'runShell',
    description:
      'Run a shell command inside the worktree root. Always use this to run `npm run check:agent` to validate changes.',
    inputSchema: z.object({
      command: z.string().describe('The shell command to execute.'),
    }),
    execute: async (args: Record<string, unknown>) => {
      const p = unwrapArgs(args);
      const command = p['command'] as string;
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: worktreePath,
          // Give check:agent enough time to complete (lint + build + tests).
          timeout: 120_000,
        });
        const out = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
        return out || '(command completed with no output)';
      } catch (err: unknown) {
        const execError = err as { stdout?: string; stderr?: string; message?: string };
        const out = [execError.stdout?.trim(), execError.stderr?.trim()].filter(Boolean).join('\n');
        return `FAILED:\n${out || execError.message || String(err)}`;
      }
    },
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Mastra sometimes nests the validated args under a 'context' key. */
function unwrapArgs(args: Record<string, unknown>): Record<string, unknown> {
  return args && typeof args['context'] === 'object' && args['context'] !== null
    ? (args['context'] as Record<string, unknown>)
    : args;
}

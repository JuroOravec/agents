/**
 * Unit tests for native filesystem and shell tools.
 *
 * Verifies:
 * - readFile returns file contents, error string on missing file
 * - listDir returns formatted directory listing, error on missing dir
 * - searchCode returns matching lines, "(no matches)" when none found
 * - writeFile creates files (and parent dirs), returns path confirmation
 * - runShell returns stdout, surfaces FAILED prefix on non-zero exit
 * - safePath rejects path traversal attempts (../ escapes)
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createListDirTool,
  createReadFileTool,
  createRunShellTool,
  createSearchCodeTool,
  createWriteFileTool,
} from './native-tools.js';

let worktreePath: string;

beforeEach(async () => {
  worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'native-tools-test-'));
});

afterEach(async () => {
  await fs.rm(worktreePath, { recursive: true, force: true });
});

// ─── readFile ──────────────────────────────────────────────────────────────

describe('createReadFileTool', () => {
  it('returns file contents for an existing file', async () => {
    await fs.writeFile(path.join(worktreePath, 'hello.ts'), 'export const x = 1;');
    const tool = createReadFileTool(worktreePath);
    const result = await tool.execute({ path: 'hello.ts' } as Record<string, unknown>);
    expect(result).toBe('export const x = 1;');
  });

  it('returns an error string for a missing file', async () => {
    const tool = createReadFileTool(worktreePath);
    const result = await tool.execute({ path: 'missing.ts' } as Record<string, unknown>);
    expect(result).toContain('Error reading file:');
  });

  it('rejects path traversal attempts', async () => {
    const tool = createReadFileTool(worktreePath);
    const result = await tool.execute({ path: '../../etc/passwd' } as Record<string, unknown>);
    expect(result).toContain('Error');
  });
});

// ─── listDir ───────────────────────────────────────────────────────────────

describe('createListDirTool', () => {
  it('lists files and directories with type prefix', async () => {
    await fs.writeFile(path.join(worktreePath, 'foo.ts'), '');
    await fs.mkdir(path.join(worktreePath, 'subdir'));
    const tool = createListDirTool(worktreePath);
    const result = await tool.execute({ path: '.' } as Record<string, unknown>);
    expect(result).toContain('f foo.ts');
    expect(result).toContain('d subdir');
  });

  it('returns an error string for a missing directory', async () => {
    const tool = createListDirTool(worktreePath);
    const result = await tool.execute({ path: 'nonexistent' } as Record<string, unknown>);
    expect(result).toContain('Error listing directory:');
  });
});

// ─── searchCode ────────────────────────────────────────────────────────────

describe('createSearchCodeTool', () => {
  it('returns matching lines when pattern is found', async () => {
    await fs.writeFile(path.join(worktreePath, 'index.ts'), 'export const hello = "world";');
    const tool = createSearchCodeTool(worktreePath);
    const result = await tool.execute({ pattern: 'hello' } as Record<string, unknown>);
    expect(result).toContain('hello');
  });

  it('returns "(no matches)" when pattern is not found', async () => {
    await fs.writeFile(path.join(worktreePath, 'index.ts'), 'const x = 1;');
    const tool = createSearchCodeTool(worktreePath);
    const result = await tool.execute({ pattern: 'nonexistent_xyz' } as Record<string, unknown>);
    expect(result).toBe('(no matches)');
  });
});

// ─── writeFile ─────────────────────────────────────────────────────────────

describe('createWriteFileTool', () => {
  it('creates a new file with the given content', async () => {
    const tool = createWriteFileTool(worktreePath);
    await tool.execute({ path: 'new.ts', content: 'const y = 2;' } as Record<string, unknown>);
    const content = await fs.readFile(path.join(worktreePath, 'new.ts'), 'utf-8');
    expect(content).toBe('const y = 2;');
  });

  it('creates parent directories as needed', async () => {
    const tool = createWriteFileTool(worktreePath);
    await tool.execute({ path: 'deep/nested/file.ts', content: 'ok' } as Record<string, unknown>);
    const content = await fs.readFile(path.join(worktreePath, 'deep/nested/file.ts'), 'utf-8');
    expect(content).toBe('ok');
  });

  it('returns a confirmation string containing the path', async () => {
    const tool = createWriteFileTool(worktreePath);
    const result = await tool.execute({ path: 'out.ts', content: '' } as Record<string, unknown>);
    expect(result).toContain('out.ts');
  });

  it('rejects path traversal attempts', async () => {
    const tool = createWriteFileTool(worktreePath);
    const result = await tool.execute({ path: '../../evil.ts', content: 'bad' } as Record<
      string,
      unknown
    >);
    expect(result).toContain('Error');
  });
});

// ─── runShell ──────────────────────────────────────────────────────────────

describe('createRunShellTool', () => {
  it('returns stdout from a successful command', async () => {
    const tool = createRunShellTool(worktreePath);
    const result = await tool.execute({ command: 'echo hello' } as Record<string, unknown>);
    expect(result).toContain('hello');
  });

  it('returns FAILED prefix when the command exits non-zero', async () => {
    const tool = createRunShellTool(worktreePath);
    const result = await tool.execute({ command: 'exit 1' } as Record<string, unknown>);
    expect(result).toContain('FAILED');
  });

  it('runs the command inside the worktree directory', async () => {
    const tool = createRunShellTool(worktreePath);
    const result = await tool.execute({ command: 'pwd' } as Record<string, unknown>);
    // Resolve symlinks so macOS /var → /private/var comparison works
    const realWorktree = await fs.realpath(worktreePath);
    expect(result.trim()).toBe(realWorktree);
  });
});

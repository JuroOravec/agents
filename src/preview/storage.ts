/**
 * Load skill-eval logs from .cursor/logs/skills/.
 * Log files: {timestamp}_{skill}_{skill_id}.json
 *
 * Also loads agent and tool logs from .cursor/logs/agents/ and .cursor/logs/tools/.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

export type SortDir = 'asc' | 'desc';

export interface SortSpec {
  path: string;
  dir: SortDir;
}

/**
 * Parse sort param string. Format: "field1,-field2" (comma-sep, - = desc).
 */
export function parseSortParam(param: string | undefined): SortSpec[] {
  if (!param || typeof param !== 'string') return [];
  return param
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({
      path: s.startsWith('-') ? s.slice(1) : s,
      dir: (s.startsWith('-') ? 'desc' : 'asc') as SortDir,
    }));
}

export function buildSortParam(spec: SortSpec[]): string {
  return spec.map((s) => (s.dir === 'desc' ? `-${s.path}` : s.path)).join(',');
}

function get(obj: object, pathStr: string): unknown {
  return pathStr.split('.').reduce((o: unknown, key) => (o as Record<string, unknown>)?.[key], obj);
}

function compareValues(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const ta = typeof a;
  const tb = typeof b;
  if (ta === 'number' && tb === 'number') return (a as number) - (b as number);
  if (ta === 'boolean' && tb === 'boolean')
    return (a as boolean) === (b as boolean) ? 0 : (a as boolean) ? 1 : -1;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export type LogEntry = { id: string; data: object };

export type LogFilterFn = (entry: LogEntry) => boolean;

export interface LogEntriesPageResult {
  entries: LogEntry[];
  totalCount: number;
}

/** Options for getLogEntriesPageWithSort */
export interface GetLogEntriesPageWithSortOpts {
  allEntries: LogEntry[];
  offset: number;
  limit: number;
  sortSpec: SortSpec[];
  filterFn?: LogFilterFn;
}

/**
 * Filter, sort, and paginate log entries.
 */
export function getLogEntriesPageWithSort(
  opts: GetLogEntriesPageWithSortOpts,
): LogEntriesPageResult {
  const { allEntries, offset, limit, sortSpec, filterFn } = opts;
  let entries = filterFn ? allEntries.filter(filterFn) : [...allEntries];
  const totalCount = entries.length;

  if (sortSpec.length > 0) {
    entries = [...entries].sort((a, b) => {
      for (const { path: p, dir } of sortSpec) {
        const va = get(a.data, p);
        const vb = get(b.data, p);
        const cmp = compareValues(va, vb);
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  return {
    entries: entries.slice(offset, offset + limit),
    totalCount,
  };
}

/**
 * Load agent logs from .cursor/logs/agents/*.jsonl.
 * Merges all agents-YYYY-MM-DD.jsonl files, one JSON object per line.
 * Returns entries sorted by finished_at descending (most recent first).
 */
export async function loadAgentLogs(logDir: string): Promise<LogEntry[]> {
  const fullPath = path.resolve(logDir);
  let files: string[];
  try {
    files = await fsp.readdir(fullPath);
  } catch {
    return [];
  }

  const jsonlFiles = files.filter((f) => f.startsWith('agents-') && f.endsWith('.jsonl')).sort();

  const entries: LogEntry[] = [];
  for (const file of jsonlFiles) {
    const filePath = path.join(fullPath, file);
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      for (let i = 0; i < lines.length; i++) {
        try {
          const data = JSON.parse(lines[i]!) as object;
          entries.push({ id: `${path.basename(file, '.jsonl')}-${i}`, data });
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  entries.sort((a, b) => {
    const fa = (a.data as Record<string, unknown>).finished_at as string | undefined;
    const fb = (b.data as Record<string, unknown>).finished_at as string | undefined;
    return (fb ?? '').localeCompare(fa ?? '');
  });
  return entries;
}

/**
 * Load prompt logs from .cursor/logs/prompts/*.jsonl.
 * Merges all prompts-YYYY-MM-DD.jsonl files, one JSON object per line.
 * Returns entries sorted by ts descending (most recent first).
 */
export async function loadPromptLogs(logDir: string): Promise<LogEntry[]> {
  const fullPath = path.resolve(logDir);
  let files: string[];
  try {
    files = await fsp.readdir(fullPath);
  } catch {
    return [];
  }

  const jsonlFiles = files.filter((f) => f.startsWith('prompts-') && f.endsWith('.jsonl')).sort();

  const entries: LogEntry[] = [];
  for (const file of jsonlFiles) {
    const filePath = path.join(fullPath, file);
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      for (let i = 0; i < lines.length; i++) {
        try {
          const data = JSON.parse(lines[i]!) as object;
          entries.push({ id: `${path.basename(file, '.jsonl')}-${i}`, data });
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  entries.sort((a, b) => {
    const fa = (a.data as Record<string, unknown>).ts as string | undefined;
    const fb = (b.data as Record<string, unknown>).ts as string | undefined;
    return (fb ?? '').localeCompare(fa ?? '');
  });
  return entries;
}

/**
 * Load chat logs from .cursor/logs/chats/*.jsonl.
 * Merges all chats-YYYY-MM-DD.jsonl files, one JSON object per line.
 * If promptsLogDir is provided, backfills started_at and user_message from matching
 * beforeSubmitPrompt logs (by conversation_id + generation_id) and persists updates in batch.
 * Returns entries sorted by finished_at descending (most recent first).
 */
export async function loadChatLogs(
  chatsLogDir: string,
  promptsLogDir?: string,
): Promise<LogEntry[]> {
  const fullPath = path.resolve(chatsLogDir);
  let files: string[];
  try {
    files = await fsp.readdir(fullPath);
  } catch {
    return [];
  }

  const jsonlFiles = files.filter((f) => f.startsWith('chats-') && f.endsWith('.jsonl')).sort();

  const byFile = new Map<string, { filePath: string; entries: LogEntry[] }>();
  const allEntries: LogEntry[] = [];

  const entryToFile = new Map<string, string>();
  for (const file of jsonlFiles) {
    const filePath = path.join(fullPath, file);
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      const fileEntries: LogEntry[] = [];
      for (let i = 0; i < lines.length; i++) {
        try {
          const data = JSON.parse(lines[i]!) as object;
          const entryId = `${path.basename(file, '.jsonl')}-${i}`;
          const entry: LogEntry = {
            id: entryId,
            data,
          };
          entryToFile.set(entryId, file);
          fileEntries.push(entry);
          allEntries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }
      byFile.set(file, { filePath, entries: fileEntries });
    } catch {
      // Skip unreadable files
    }
  }

  if (promptsLogDir) {
    const promptsEntries = await loadPromptLogs(promptsLogDir);
    const promptByKey = new Map<string, { ts: string; user_message: string }>();
    for (const pe of promptsEntries) {
      const d = pe.data as Record<string, unknown>;
      const cid = (d.conversation_id as string) ?? '';
      const gid = (d.generation_id as string) ?? '';
      const ts = (d.ts as string) ?? '';
      const userMessage = (d.user_message as string) ?? '';
      if (cid && gid && ts) {
        promptByKey.set(`${cid}|${gid}`, { ts, user_message: userMessage });
      }
    }

    const modifiedFiles = new Set<string>();
    for (const entry of allEntries) {
      const d = entry.data as Record<string, unknown>;
      const cid = (d.conversation_id as string) ?? '';
      const gid = (d.generation_id as string) ?? '';
      const key = `${cid}|${gid}`;
      const match = promptByKey.get(key);
      if (!match) continue;
      let changed = false;
      if (d.started_at !== match.ts) {
        d.started_at = match.ts;
        changed = true;
      }
      if (d.user_message !== match.user_message) {
        d.user_message = match.user_message;
        changed = true;
      }
      if (changed) {
        const sourceFile = entryToFile.get(entry.id);
        if (sourceFile) modifiedFiles.add(sourceFile);
      }
    }

    for (const [fileName, { filePath, entries }] of byFile) {
      if (!modifiedFiles.has(fileName)) continue;
      const lines = entries
        .map((e) => JSON.stringify(e.data))
        .join('\n')
        .concat(entries.length ? '\n' : '');
      await fsp.writeFile(filePath, lines, 'utf-8');
    }
  }

  allEntries.sort((a, b) => {
    const fa = (a.data as Record<string, unknown>).finished_at as string | undefined;
    const fb = (b.data as Record<string, unknown>).finished_at as string | undefined;
    return (fb ?? '').localeCompare(fa ?? '');
  });
  return allEntries;
}

/**
 * Load thought logs from .cursor/logs/thoughts/*.jsonl.
 * Merges all thoughts-YYYY-MM-DD.jsonl files.
 * Returns entries sorted by finished_at descending (most recent first).
 */
export async function loadThoughtLogs(logDir: string): Promise<LogEntry[]> {
  const fullPath = path.resolve(logDir);
  let files: string[];
  try {
    files = await fsp.readdir(fullPath);
  } catch {
    return [];
  }

  const jsonlFiles = files.filter((f) => f.startsWith('thoughts-') && f.endsWith('.jsonl')).sort();

  const entries: LogEntry[] = [];
  for (const file of jsonlFiles) {
    const filePath = path.join(fullPath, file);
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      for (let i = 0; i < lines.length; i++) {
        try {
          const data = JSON.parse(lines[i]!) as object;
          entries.push({ id: `${path.basename(file, '.jsonl')}-${i}`, data });
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  entries.sort((a, b) => {
    const fa = (a.data as Record<string, unknown>).finished_at as string | undefined;
    const fb = (b.data as Record<string, unknown>).finished_at as string | undefined;
    return (fb ?? '').localeCompare(fa ?? '');
  });
  return entries;
}

/**
 * Load tool logs from .cursor/logs/tools/*.jsonl.
 * Merges all tools-YYYY-MM-DD.jsonl files, one JSON object per line.
 * Returns entries sorted by finished_at descending (most recent first).
 */
export async function loadToolLogs(logDir: string): Promise<LogEntry[]> {
  const fullPath = path.resolve(logDir);
  let files: string[];
  try {
    files = await fsp.readdir(fullPath);
  } catch {
    return [];
  }

  const jsonlFiles = files.filter((f) => f.startsWith('tools-') && f.endsWith('.jsonl')).sort();

  const entries: LogEntry[] = [];
  for (const file of jsonlFiles) {
    const filePath = path.join(fullPath, file);
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      for (let i = 0; i < lines.length; i++) {
        try {
          const data = JSON.parse(lines[i]!) as object;
          entries.push({ id: `${path.basename(file, '.jsonl')}-${i}`, data });
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  entries.sort((a, b) => {
    const fa = (a.data as Record<string, unknown>).finished_at as string | undefined;
    const fb = (b.data as Record<string, unknown>).finished_at as string | undefined;
    return (fb ?? '').localeCompare(fa ?? '');
  });
  return entries;
}

export interface SkillEvalStep {
  phase: number;
  completed_at: string;
  skipped?: boolean;
}

export interface SkillEvalRun {
  created_at: string;
  /** Cursor's conversation_id */
  conversation_id: string;
  skill_id: string;
  skill: string;
  steps: SkillEvalStep[];
  /** Filename for reference */
  filename: string;
}

/**
 * Load all skill-eval JSON files from the log directory.
 * Sorted by created_at ascending.
 */
export async function loadSkillEvalLogs(logDir: string): Promise<SkillEvalRun[]> {
  const fullPath = path.resolve(logDir);
  let files: string[];
  try {
    files = await fsp.readdir(fullPath);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const runs: SkillEvalRun[] = [];

  for (const file of jsonFiles) {
    const filePath = path.join(fullPath, file);
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as {
        created_at?: string;
        conversation_id?: string;
        skill_id?: string;
        skill?: string;
        steps?: SkillEvalStep[];
      };
      if (data.skill && data.skill_id) {
        runs.push({
          created_at: data.created_at ?? '',
          conversation_id: data.conversation_id ?? '',
          skill_id: data.skill_id ?? '',
          skill: data.skill,
          steps: data.steps ?? [],
          filename: file,
        });
      }
    } catch {
      // Skip malformed files
    }
  }

  runs.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return runs;
}

export type WaterfallEntryType = 'thought' | 'tool' | 'agent' | 'skill';

export interface ChatWaterfallEntry {
  type: WaterfallEntryType;
  label: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  /** Metadata for tooltip (key-value pairs, values stringified for display) */
  metadata: Record<string, string | number | boolean | undefined>;
}

/** Options for getChatWaterfallEntries */
export interface GetChatWaterfallEntriesOpts {
  chat: LogEntry;
  thoughts: LogEntry[];
  tools: LogEntry[];
  agents: LogEntry[];
  skills: SkillEvalRun[];
}

/**
 * Build waterfall entries for a chat: thoughts, tools, agents, skills that fall
 * within the chat's time window and match conversation_id.
 * Sorted by started_at ascending (earlier at top).
 */
export function getChatWaterfallEntries(opts: GetChatWaterfallEntriesOpts): ChatWaterfallEntry[] {
  const { chat, thoughts, tools, agents, skills } = opts;
  const chatData = chat.data as Record<string, unknown>;
  const convId = (chatData.conversation_id as string) ?? '';
  const chatStart = (chatData.started_at as string) ?? '';
  const chatEnd = (chatData.finished_at as string) ?? '';
  if (!convId || !chatStart || !chatEnd) return [];

  const chatStartMs = new Date(chatStart).getTime();
  const chatEndMs = new Date(chatEnd).getTime();

  const inWindow = (start: string, end: string) => {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    return s >= chatStartMs && e <= chatEndMs;
  };

  const inWindowPoint = (ts: string) => {
    const t = new Date(ts).getTime();
    return t >= chatStartMs && t <= chatEndMs;
  };

  const entries: ChatWaterfallEntry[] = [];

  for (const t of thoughts) {
    const d = t.data as Record<string, unknown>;
    if ((d.conversation_id as string) !== convId) continue;
    const start = (d.started_at as string) ?? '';
    const end = (d.finished_at as string) ?? '';
    if (!inWindow(start, end)) continue;
    const dur = (d.duration_ms as number) ?? 0;
    const text = ((d.text as string) ?? '').slice(0, 80);
    entries.push({
      type: 'thought',
      label: 'Thinking',
      started_at: start,
      finished_at: end,
      duration_ms: dur,
      metadata: {
        text: text || '(empty)',
        duration_ms: dur,
        model: String(d.model ?? ''),
      },
    });
  }

  for (const t of tools) {
    const d = t.data as Record<string, unknown>;
    if ((d.conversation_id as string) !== convId) continue;
    const start = (d.started_at as string) ?? '';
    const end = (d.finished_at as string) ?? '';
    if (!inWindow(start, end)) continue;
    const dur = (d.duration as number) ?? 0; // duration in ms (from postToolUse)
    const toolName = (d.tool_name as string) ?? '?';
    const event = (d.event as string) ?? '';
    entries.push({
      type: 'tool',
      label: `Tool: ${toolName}`,
      started_at: start,
      finished_at: end,
      duration_ms: dur,
      metadata: {
        tool_name: toolName,
        event,
        duration_ms: Math.round(dur),
        cwd: String(d.cwd ?? ''),
      },
    });
  }

  for (const a of agents) {
    const d = a.data as Record<string, unknown>;
    if ((d.conversation_id as string) !== convId) continue;
    const start = (d.started_at as string) ?? '';
    const end = (d.finished_at as string) ?? '';
    if (!inWindow(start, end)) continue;
    const dur = (d.duration as number) ?? 0;
    const subagentType = (d.subagent_type as string) ?? '?';
    const status = (d.status as string) ?? '';
    entries.push({
      type: 'agent',
      label: `Agent: ${subagentType}`,
      started_at: start,
      finished_at: end,
      duration_ms: dur,
      metadata: {
        subagent_type: subagentType,
        status,
        duration_ms: dur,
      },
    });
  }

  for (const s of skills) {
    const matchesConv = s.conversation_id && s.conversation_id === convId;
    if (!matchesConv) continue;
    if (!inWindowPoint(s.created_at)) continue;
    const createdMs = new Date(s.created_at).getTime();
    const lastStep = s.steps[s.steps.length - 1];
    const endMs = lastStep?.completed_at ? new Date(lastStep.completed_at).getTime() : createdMs;
    const dur = endMs - createdMs;
    entries.push({
      type: 'skill',
      label: `Skill: ${s.skill}`,
      started_at: s.created_at,
      finished_at: lastStep?.completed_at ?? s.created_at,
      duration_ms: dur,
      metadata: {
        skill: s.skill,
        skill_id: s.skill_id,
        steps: s.steps.length,
        duration_ms: dur,
      },
    });
  }

  entries.sort((a, b) => a.started_at.localeCompare(b.started_at));
  return entries;
}

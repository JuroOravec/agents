/**
 * Load skill-eval logs from .cursor/logs/skills-eval/.
 * Log files: {timestamp}_{skill}_{skill_id}.json
 *
 * Also loads agent and tool logs from .cursor/logs/agents/ and .cursor/logs/tools/.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

export type SortDir = "asc" | "desc";

export interface SortSpec {
  path: string;
  dir: SortDir;
}

/**
 * Parse sort param string. Format: "field1,-field2" (comma-sep, - = desc).
 */
export function parseSortParam(param: string | undefined): SortSpec[] {
  if (!param || typeof param !== "string") return [];
  return param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({
      path: s.startsWith("-") ? s.slice(1) : s,
      dir: (s.startsWith("-") ? "desc" : "asc") as SortDir,
    }));
}

export function buildSortParam(spec: SortSpec[]): string {
  return spec.map((s) => (s.dir === "desc" ? `-${s.path}` : s.path)).join(",");
}

function get(obj: object, pathStr: string): unknown {
  return pathStr.split(".").reduce(
    (o: unknown, key) => (o as Record<string, unknown>)?.[key],
    obj
  );
}

function compareValues(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const ta = typeof a;
  const tb = typeof b;
  if (ta === "number" && tb === "number")
    return (a as number) - (b as number);
  if (ta === "boolean" && tb === "boolean")
    return (a as boolean) === (b as boolean) ? 0 : (a as boolean) ? 1 : -1;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export type LogEntry = { id: string; data: object };

export type LogFilterFn = (entry: LogEntry) => boolean;

export interface LogEntriesPageResult {
  entries: LogEntry[];
  totalCount: number;
}

/**
 * Filter, sort, and paginate log entries.
 */
export function getLogEntriesPageWithSort(
  allEntries: LogEntry[],
  offset: number,
  limit: number,
  sortSpec: SortSpec[],
  filterFn?: LogFilterFn
): LogEntriesPageResult {
  let entries = filterFn ? allEntries.filter(filterFn) : [...allEntries];
  const totalCount = entries.length;

  if (sortSpec.length > 0) {
    entries = [...entries].sort((a, b) => {
      for (const { path: p, dir } of sortSpec) {
        const va = get(a.data, p);
        const vb = get(b.data, p);
        const cmp = compareValues(va, vb);
        if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
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

  const jsonlFiles = files
    .filter((f) => f.startsWith("agents-") && f.endsWith(".jsonl"))
    .sort();

  const entries: LogEntry[] = [];
  for (const file of jsonlFiles) {
    const filePath = path.join(fullPath, file);
    try {
      const content = await fsp.readFile(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      for (let i = 0; i < lines.length; i++) {
        try {
          const data = JSON.parse(lines[i]!) as object;
          entries.push({ id: `${path.basename(file, ".jsonl")}-${i}`, data });
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
    return (fb ?? "").localeCompare(fa ?? "");
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

  const jsonlFiles = files
    .filter((f) => f.startsWith("tools-") && f.endsWith(".jsonl"))
    .sort();

  const entries: LogEntry[] = [];
  for (const file of jsonlFiles) {
    const filePath = path.join(fullPath, file);
    try {
      const content = await fsp.readFile(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      for (let i = 0; i < lines.length; i++) {
        try {
          const data = JSON.parse(lines[i]!) as object;
          entries.push({ id: `${path.basename(file, ".jsonl")}-${i}`, data });
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
    return (fb ?? "").localeCompare(fa ?? "");
  });
  return entries;
}

export interface SkillEvalStep {
  phase: number;
  completedAt: string;
  skipped?: boolean;
}

export interface SkillEvalRun {
  createdAt: string;
  session_id: string;
  skill_id: string;
  skill: string;
  steps: SkillEvalStep[];
  /** Filename for reference */
  filename: string;
}

/**
 * Load all skill-eval JSON files from the log directory.
 * Sorted by createdAt ascending.
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
        createdAt?: string;
        session_id?: string;
        skill_id?: string;
        skill?: string;
        steps?: SkillEvalStep[];
      };
      if (data.skill && data.skill_id) {
        runs.push({
          createdAt: data.createdAt ?? '',
          session_id: data.session_id ?? '',
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

  runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return runs;
}

/**
 * HTML page generators for the skills dashboard.
 * Skills page: heatmap (skill x phase) + line chart (success over time).
 * Agents/Tools pages: tables with filter, sort, pagination.
 */

import type { PhaseInfo } from "../validate/skill-phases.js";
import type {
  LogEntry,
  SkillEvalRun,
  SortSpec,
} from "./storage.js";
import { buildSortParam } from "./storage.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Shared nav: Skills, Agents, Tools, Prompts. */
function navLinks(): string {
  return `<a href="/skills">Skills</a> <span>|</span> <a href="/agents">Agents</a> <span>|</span> <a href="/tools">Tools</a> <span>|</span> <a href="/prompts">Prompts</a>`;
}

const layoutStart = (title: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Skill-eval dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/apexcharts@3.45.1/dist/apexcharts.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 1rem 2rem; line-height: 1.5; color: #1a1a1a; }
    nav { margin-bottom: 1.5rem; font-size: 0.9rem; }
    nav a { color: #0066cc; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    h1 { font-size: 1.25rem; margin: 0 0 1rem; }
    h2 { font-size: 1rem; margin: 1.5rem 0 0.5rem; }
    .chart-container { margin: 1rem 0; }
    .heatmap-cell { padding: 0.25rem 0.5rem; font-size: 0.75rem; text-align: center; min-width: 2.5rem; }
    table { border-collapse: collapse; width: 100%; font-size: 0.875rem; }
    th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    tr:hover { background: #fafafa; }
    .pagination { margin-top: 1rem; }
    .pagination a, .pagination span { margin-right: 0.5rem; }
    .table-scroll { overflow: auto; min-height: 150px; height: calc(100vh - 320px); margin: 1rem 0; }
    .table-scroll th { position: sticky; top: 0; background: #f5f5f5; z-index: 1; box-shadow: 0 1px 0 #ccc; }
    .sort-header { white-space: nowrap; cursor: pointer; user-select: none; }
    .sort-header:hover { background: #ebebeb; }
    .sort-header .sort-icons { font-size: 0.75rem; margin-left: 0.25rem; }
    .sort-header .sort-icons .arrow-up, .sort-header .sort-icons .arrow-down { color: #999; }
    .sort-header.sort-asc .sort-icons .arrow-up { color: #0066cc; }
    .sort-header.sort-desc .sort-icons .arrow-down { color: #0066cc; }
    .filter-form { margin: 1rem 0; }
    .filter-form textarea { width: 100%; min-height: 2rem; font-family: monospace; font-size: 0.85rem; padding: 0.5rem; }
    .filter-error { font-size: 0.85rem; color: #c00; margin-top: 0.25rem; }
  </style>
</head>
<body>
  <nav>${navLinks()}</nav>
  <main>
`;

const layoutEnd = `
  </main>
</body>
</html>
`;

export interface HeatmapData {
  skills: string[];
  phases: { key: string; title: string }[];
  /** skillIndex -> phaseIndex -> 0..100 (success rate), or -1 for n/a (phase not in skill) */
  values: number[][];
}

export interface LineChartPoint {
  x: string; // ISO timestamp
  y: number; // 0..100 success rate
  runId: string;
}

/**
 * Compute heatmap data: for each (skill, phase), % of that skill's runs that completed that phase.
 */
export function computeHeatmapData(
  runs: SkillEvalRun[],
  skillPhasesMap: Map<string, PhaseInfo[]>,
): HeatmapData {
  // Group runs by skill name
  const runsBySkill = new Map<string, SkillEvalRun[]>();
  for (const run of runs) {
    const list = runsBySkill.get(run.skill) ?? [];
    list.push(run);
    runsBySkill.set(run.skill, list);
  }

  // Rows = skills that have at least one run; cols = union of all phase keys across those skills
  // e.g. if skill "A" has phases 1, 2, and skill "B" has phases 1, 2, 3, the phases array will be [1, 2, 3]
  const skills = Array.from(runsBySkill.keys()).sort();
  const allPhaseKeys = new Set<string>();
  for (const skill of skills) {
    const phases = skillPhasesMap.get(skill) ?? [];
    for (const p of phases) allPhaseKeys.add(p.key);
  }
  // Sort phases: 1, 2, 2a, 2b, 3, … (numeric first, then suffix)
  const phases = Array.from(allPhaseKeys).sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ""), 10);
    const nb = parseInt(b.replace(/\D/g, ""), 10);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });

  const phaseToIndex = new Map(phases.map((p, i) => [p, i]));
  const values: number[][] = skills.map(() => phases.map(() => -1)); // -1 = n/a (phase not in skill)

  for (let si = 0; si < skills.length; si++) {
    const skillRuns = runsBySkill.get(skills[si]!) ?? [];
    const expectedPhases = skillPhasesMap.get(skills[si]!) ?? [];
    const phaseKeys = new Set(expectedPhases.map((p) => p.key));

    for (let pi = 0; pi < phases.length; pi++) {
      const phaseKey = phases[pi]!;
      if (!phaseKeys.has(phaseKey)) continue; // Phase not in this skill — leave -1 (n/a)
      const phaseNum = parseInt(phaseKey.replace(/\D/g, ""), 10);
      // Match steps by phase number or exact key (handles "2" vs "2a" when JSON stores numeric)
      const completed = skillRuns.filter((r) =>
        r.steps.some(
          (s) => s.phase === phaseNum || String(s.phase) === phaseKey,
        ),
      ).length;
      const total = skillRuns.length;
      values[si]![pi] = total > 0 ? Math.round((completed / total) * 100) : 0;
    }
  }

  return {
    skills,
    phases: phases.map((key) => {
      const info = skills
        .flatMap((s) => skillPhasesMap.get(s) ?? [])
        .find((p) => p.key === key);
      return { key, title: info?.title ?? key };
    }),
    values,
  };
}

/**
 * Compute line chart data: for each skill, points (created_at, successRate) ordered by time.
 */
export function computeLineChartData(
  runs: SkillEvalRun[],
  skillPhasesMap: Map<string, PhaseInfo[]>,
): Map<string, LineChartPoint[]> {
  // Group runs by skill
  const bySkill = new Map<string, SkillEvalRun[]>();
  for (const run of runs) {
    const list = bySkill.get(run.skill) ?? [];
    list.push(run);
    bySkill.set(run.skill, list);
  }

  const result = new Map<string, LineChartPoint[]>();
  for (const [skill, skillRuns] of bySkill) {
    const phases = skillPhasesMap.get(skill) ?? [];
    const expectedCount = phases.length;
    if (expectedCount === 0) continue; // No phases defined → skip (can't compute rate)

    // Order runs by created_at (chronological)
    const sorted = [...skillRuns].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    const points: LineChartPoint[] = sorted.map((run) => {
      // Success rate = (completed phases / expected phases) × 100
      const completedCount = run.steps.length;
      const rate = Math.round((completedCount / expectedCount) * 100);
      return {
        x: run.created_at,
        y: Math.min(100, rate),
        runId: run.skill_id,
      };
    });
    result.set(skill, points);
  }
  return result;
}

/**
 * Interpolate green (100) -> red (0) for a value 0..100.
 * RGB: green=#22c55e (34,197,94), red=#ef4444 (239,68,68).
 */
function colorForRate(rate: number): string {
  if (rate >= 100) return "#22c55e";
  if (rate <= 0) return "#ef4444";
  const r = Math.round(255 - (rate / 100) * (255 - 34));
  const g = Math.round(34 + (rate / 100) * (197 - 34));
  const b = Math.round(68 + (rate / 100) * (94 - 68));
  return `rgb(${r},${g},${b})`;
}

export function pageSkills(
  heatmapData: HeatmapData,
  lineChartData: Map<string, LineChartPoint[]>,
  runsCount: number,
): string {
  const heatmapRows = heatmapData.skills
    .map(
      (skill, si) =>
        `<tr>
  <td class="heatmap-cell" style="font-weight:500">${escapeHtml(skill)}</td>
  ${heatmapData.phases
    .map((_, pi) => {
      const v = heatmapData.values[si]![pi] ?? -1;
      if (v < 0) {
        return `<td class="heatmap-cell" style="background:#eee;color:#999" title="N/A">—</td>`;
      }
      const bg = colorForRate(v);
      return `<td class="heatmap-cell" style="background:${bg};color:${v > 50 ? "#fff" : "#333"}" title="Phase ${heatmapData.phases[pi]!.key}: ${v}%">${v}%</td>`;
    })
    .join("")}
</tr>`,
    )
    .join("");

  const heatmapHeaders = heatmapData.phases
    .map((p) => `<th class="heatmap-cell">${escapeHtml(p.key)}</th>`)
    .join("");

  const lineSeries = Array.from(lineChartData.entries()).map(
    ([skill, points]) => ({
      name: skill,
      data: points.map((p) => ({ x: p.x, y: p.y })),
    }),
  );

  const containerId = `line-${Math.random().toString(36).slice(2, 11)}`;
  const lineSeriesJson = JSON.stringify(lineSeries).replace(/</g, "\\u003c");

  const emptyMsg =
    runsCount === 0
      ? "<p>No skill-eval logs found. Run skills with skill-eval to collect data.</p>"
      : "";

  return `${layoutStart("Skills")}
<h1>Skills</h1>
<p>${runsCount} run${runsCount === 1 ? "" : "s"} in .cursor/logs/skills/</p>
${emptyMsg}
<h2>Heatmap: skill × phase (success rate %)</h2>
<p class="chart-container">Each cell: % of that skill's runs that completed that phase. Green = 100%, red = 0%.</p>
<div class="chart-container">
  <table style="border-collapse:collapse">
    <thead><tr><th class="heatmap-cell">skill</th>${heatmapHeaders}</tr></thead>
    <tbody>${heatmapRows}</tbody>
  </table>
</div>
<h2>Success rate over time (by skill)</h2>
<p class="chart-container">Each line = one skill. Y = 0–100% (completed phases / expected phases). Ordered by run timestamp.</p>
<div id="${escapeHtml(containerId)}" class="chart-container" style="width:800px;height:400px;"></div>
<script>
(function(){
  var el=document.getElementById("${escapeHtml(containerId)}");
  if(!el||typeof ApexCharts==="undefined")return;
  var series=${lineSeriesJson};
  new ApexCharts(el,{
    series: series.map(function(s){ return { name: s.name, data: s.data }; }),
    chart: { type: "line", height: 400, toolbar: { show: true } },
    stroke: { curve: "stepline", width: 2 },
    xaxis: { type: "datetime", labels: { datetimeUTC: false } },
    yaxis: { min: 0, max: 100, tickAmount: 5, labels: { formatter: function(v){ return v+"%"; } } },
    legend: { position: "top", horizontalAlign: "left" }
  }).render();
})();
</script>
${layoutEnd}`;
}

export function pageError(message: string): string {
  return `${layoutStart("Error")}
<h1>Error</h1>
<p>${escapeHtml(message)}</p>
${layoutEnd}`;
}

/** Agent schema columns (design doc order). */
const AGENT_COLUMNS = [
  "finished_at",
  "started_at",
  "event",
  "subagent_type",
  "status",
  "duration",
];

/** Prompt schema columns. */
const PROMPT_COLUMNS = [
  "ts",
  "conversation_id",
  "generation_id",
  "hook",
  "last_turn_preview",
  "context",
  "user_message",
];

/** Tool schema columns (union of success + failure). */
const TOOL_COLUMNS = [
  "finished_at",
  "started_at",
  "event",
  "tool_name",
  "tool_use_id",
  "cwd",
  "duration",
  "model",
  "tool_input",
  "error_message",
  "failure_type",
  "is_interrupt",
];

function formatCellValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  }
  return String(v);
}

function buildLogQuery(
  page: number,
  sortParam: string,
  filterValue: string
): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (sortParam) params.set("sort", sortParam);
  if (filterValue) params.set("filter", filterValue);
  const q = params.toString();
  return q ? `?${q}` : "";
}

/**
 * Build a log table page (agents or tools). Reuses crawlee-one table pattern.
 */
function pageLogTable(
  title: string,
  basePath: string,
  columns: string[],
  entries: LogEntry[],
  totalCount: number,
  page: number,
  pageSize: number,
  sortSpec: SortSpec[],
  filterValue: string,
  filterError: string | null,
  emptyMsg: string,
  filterPlaceholder: string
): string {
  const currentSortParam = buildSortParam(sortSpec);
  const query = buildLogQuery(page, currentSortParam, filterValue);

  const sortByPath = new Map(
    sortSpec.map((s, i) => [s.path, { dir: s.dir, order: i }])
  );

  let tableRows = "";
  for (const entry of entries) {
    const data = entry.data as Record<string, unknown>;
    tableRows += "<tr>";
    for (const col of columns) {
      const v = data[col];
      tableRows += `<td>${escapeHtml(formatCellValue(v))}</td>`;
    }
    tableRows += "</tr>";
  }

  let thead = "<tr>";
  for (const col of columns) {
    const current = sortByPath.get(col);
    let nextSort: SortSpec[];
    let sortClass = "";
    if (!current) {
      nextSort = [{ path: col, dir: "asc" }, ...sortSpec.filter((s) => s.path !== col)];
    } else if (current.dir === "asc") {
      nextSort = sortSpec.map((s) =>
        s.path === col ? { path: col, dir: "desc" as const } : s
      );
      sortClass = " sort-asc";
    } else {
      nextSort = sortSpec.filter((s) => s.path !== col);
      sortClass = " sort-desc";
    }
    const nextParam = buildSortParam(nextSort);
    const href = `${basePath}${buildLogQuery(1, nextParam, filterValue)}`;
    thead += `<th class="sort-header${sortClass}"><a href="${escapeHtml(href)}" style="text-decoration:none;color:inherit">${escapeHtml(col)}<span class="sort-icons"><span class="arrow-up">↑</span><span class="arrow-down">↓</span></span></a></th>`;
  }
  thead += "</tr>";

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  let pagination = '<div class="pagination">';
  if (page > 1) {
    pagination += `<a href="${escapeHtml(basePath)}${buildLogQuery(page - 1, currentSortParam, filterValue)}">Previous</a> `;
  }
  pagination += `Page ${page} of ${totalPages} (${totalCount} total)`;
  if (page < totalPages) {
    pagination += ` <a href="${escapeHtml(basePath)}${buildLogQuery(page + 1, currentSortParam, filterValue)}">Next</a>`;
  }
  pagination += "</div>";

  const filterForm =
    `<form class="filter-form" method="get" action="${escapeHtml(basePath)}">
  <textarea name="filter" placeholder="${escapeHtml(filterPlaceholder)}">${escapeHtml(filterValue)}</textarea>
  <input type="hidden" name="sort" value="${escapeHtml(currentSortParam)}">
  <input type="hidden" name="page" value="1">
  <button type="submit">Apply filter</button>
</form>` +
    (filterError ? `<p class="filter-error">Filter error: ${escapeHtml(filterError)}</p>` : "");

  return `${layoutStart(title)}
<h1>${escapeHtml(title)}</h1>
<p>${totalCount} entr${totalCount === 1 ? "y" : "ies"}</p>
${totalCount === 0 ? emptyMsg : ""}
${filterForm}
<div class="table-scroll">
  <table>
    <thead>${thead}</thead>
    <tbody>${tableRows}</tbody>
  </table>
</div>
${pagination}
${layoutEnd}`;
}

export function pageAgents(
  entries: LogEntry[],
  totalCount: number,
  page: number,
  pageSize: number,
  sortSpec: SortSpec[],
  filterValue: string,
  filterError: string | null
): string {
  return pageLogTable(
    "Agents",
    "/agents",
    AGENT_COLUMNS,
    entries,
    totalCount,
    page,
    pageSize,
    sortSpec,
    filterValue,
    filterError,
    "<p>No agent logs found. Subagent runs are logged when subagentStop hook fires.</p>",
    "obj.subagent_type === 'architect'  // JS expression, obj = log entry"
  );
}

export function pagePrompts(
  entries: LogEntry[],
  totalCount: number,
  page: number,
  pageSize: number,
  sortSpec: SortSpec[],
  filterValue: string,
  filterError: string | null
): string {
  return pageLogTable(
    "Prompts",
    "/prompts",
    PROMPT_COLUMNS,
    entries,
    totalCount,
    page,
    pageSize,
    sortSpec,
    filterValue,
    filterError,
    "<p>No prompt logs found. Prompts are logged when beforeSubmitPrompt hook fires (capture-prompts.sh).</p>",
    "obj.conversation_id === 'uuid'  // JS expression, obj = log entry"
  );
}

export function pageTools(
  entries: LogEntry[],
  totalCount: number,
  page: number,
  pageSize: number,
  sortSpec: SortSpec[],
  filterValue: string,
  filterError: string | null
): string {
  return pageLogTable(
    "Tools",
    "/tools",
    TOOL_COLUMNS,
    entries,
    totalCount,
    page,
    pageSize,
    sortSpec,
    filterValue,
    filterError,
    "<p>No tool logs found. Tool invocations are logged when postToolUse/postToolUseFailure hooks fire.</p>",
    "obj.tool_name === 'Shell'  // JS expression, obj = log entry"
  );
}

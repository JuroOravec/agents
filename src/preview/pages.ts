/**
 * HTML page generators for the skills dashboard.
 * Skills page: heatmap (skill x phase) + line chart (success over time).
 * Agents/Tools pages: tables with filter, sort, pagination.
 */

import type { PhaseInfo } from '../engine/validate/skill-phases.js';
import type { ChatWaterfallEntry, LogEntry, SkillEvalRun, SortSpec } from './storage.js';
import { buildSortParam } from './storage.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Shared nav: Skills, Agents, Tools, Prompts, Chats. */
function navLinks(): string {
  return `</span> <a href="/chats">Chats</a> | </span> <a href="/agents">Agents</a> <span>|<a href="/skills"> Skills </a> <span>|</span> <a href="/tools">Tools</a> <span>|</span> <a href="/prompts">Prompts</a> <span>`;
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
    th, td { border: 1px solid #ccc; padding: 0.3rem 0.6rem; text-align: left; }
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
    const na = parseInt(a.replace(/\D/g, ''), 10);
    const nb = parseInt(b.replace(/\D/g, ''), 10);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });

  const values: number[][] = skills.map(() => phases.map(() => -1)); // -1 = n/a (phase not in skill)

  for (let si = 0; si < skills.length; si++) {
    const skillRuns = runsBySkill.get(skills[si]!) ?? [];
    const expectedPhases = skillPhasesMap.get(skills[si]!) ?? [];
    const phaseKeys = new Set(expectedPhases.map((p) => p.key));

    for (let pi = 0; pi < phases.length; pi++) {
      const phaseKey = phases[pi]!;
      if (!phaseKeys.has(phaseKey)) continue; // Phase not in this skill — leave -1 (n/a)
      const phaseNum = parseInt(phaseKey.replace(/\D/g, ''), 10);
      // Match steps by phase number or exact key (handles "2" vs "2a" when JSON stores numeric)
      const completed = skillRuns.filter((r) =>
        r.steps.some((s) => s.phase === phaseNum || String(s.phase) === phaseKey),
      ).length;
      const total = skillRuns.length;
      values[si]![pi] = total > 0 ? Math.round((completed / total) * 100) : 0;
    }
  }

  return {
    skills,
    phases: phases.map((key) => {
      const info = skills.flatMap((s) => skillPhasesMap.get(s) ?? []).find((p) => p.key === key);
      return { key, title: info?.title ?? key };
    }),
    values,
  };
}

/** Point for skills-per-day chart: x = date, y = count, avgPerConv = runs / unique sessions */
export interface SkillsPerDayPoint {
  x: string;
  y: number;
  /** Avg. number of skill runs per session (count / unique sessions) for that day */
  avgPerConv: number;
}

/**
 * Compute skill runs count and avg runs per session by day.
 * Uses created_at for date and conversation_id for unique sessions.
 */
export function computeSkillsPerDayChartData(runs: SkillEvalRun[]): SkillsPerDayPoint[] {
  const byDate = new Map<string, { count: number; sessions: Set<string> }>();
  for (const run of runs) {
    const date = run.created_at.slice(0, 10);
    if (!date) continue;
    const prev = byDate.get(date) ?? { count: 0, sessions: new Set<string>() };
    prev.count++;
    if (run.conversation_id) prev.sessions.add(run.conversation_id);
    byDate.set(date, prev);
  }
  return Array.from(byDate.entries())
    .map(([date, { count, sessions }]) => ({
      x: date,
      y: count,
      avgPerConv: sessions.size > 0 ? count / sessions.size : 0,
    }))
    .sort((a, b) => a.x.localeCompare(b.x));
}

/**
 * Compute skill runs count per day, grouped by skill name.
 * Returns Map<skill, {x, y}[]> with zeros for missing dates.
 */
export function computeSkillsPerDayByTypeChartData(
  runs: SkillEvalRun[],
): Map<string, ToolChartPoint[]> {
  const byTypeAndDate = new Map<string, number>();
  const allDates = new Set<string>();
  for (const run of runs) {
    const date = run.created_at.slice(0, 10);
    if (!date) continue;
    allDates.add(date);
    const key = `${run.skill}|${date}`;
    byTypeAndDate.set(key, (byTypeAndDate.get(key) ?? 0) + 1);
  }

  const sortedDates = Array.from(allDates).sort();
  const byType = new Map<string, Map<string, number>>();
  for (const [key, count] of byTypeAndDate) {
    const [skill, date] = key.split('|') as [string, string];
    const inner = byType.get(skill) ?? new Map<string, number>();
    inner.set(date, count);
    byType.set(skill, inner);
  }

  const result = new Map<string, ToolChartPoint[]>();
  for (const [skill, dateToCount] of byType) {
    const points: ToolChartPoint[] = sortedDates.map((date) => ({
      x: date,
      y: dateToCount.get(date) ?? 0,
    }));
    result.set(skill, points);
  }
  return result;
}

/**
 * Compute skill success rate by day: for each (skill, date), success rate = runs that completed all phases / total.
 */
export function computeSkillSuccessRateChartData(
  runs: SkillEvalRun[],
  skillPhasesMap: Map<string, PhaseInfo[]>,
): Map<string, ToolChartPoint[]> {
  const agg = new Map<string, { success: number; total: number }>();
  for (const run of runs) {
    const date = run.created_at.slice(0, 10);
    if (!date) continue;
    const phases = skillPhasesMap.get(run.skill) ?? [];
    const expectedCount = phases.length;
    const completedCount = run.steps.length;
    const success = expectedCount > 0 && completedCount >= expectedCount ? 1 : 0;
    const key = `${run.skill}|${date}`;
    const prev = agg.get(key) ?? { success: 0, total: 0 };
    agg.set(key, { success: prev.success + success, total: prev.total + 1 });
  }

  const bySkill = new Map<string, { date: string; success: number; total: number }[]>();
  for (const [key, v] of agg) {
    const [skill, date] = key.split('|') as [string, string];
    const list = bySkill.get(skill) ?? [];
    list.push({ date, success: v.success, total: v.total });
    bySkill.set(skill, list);
  }

  const result = new Map<string, ToolChartPoint[]>();
  for (const [skill, list] of bySkill) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const points: ToolChartPoint[] = list.map(({ date, success, total }) => ({
      x: date,
      y: total > 0 ? Math.round((success / total) * 100) : 0,
    }));
    result.set(skill, points);
  }
  return result;
}

/**
 * Compute time spent in skill workflows as % of time spent working, by day.
 * For each day: find chat periods (started_at..finished_at) and skill periods (created_at..lastStep.completed_at)
 * that overlap that day; match by conversation_id; sum overlapping duration.
 * Y = 0–100% (time in skills / time working).
 */
export function computeSkillTimeShareChartData(
  chats: LogEntry[],
  runs: SkillEvalRun[],
): ToolChartPoint[] {
  const allDates = new Set<string>();
  type Interval = { startMs: number; endMs: number };

  const chatPeriodsByDate = new Map<string, Map<string, Interval[]>>();
  for (const entry of chats) {
    const d = entry.data as Record<string, unknown>;
    const convId = (d.conversation_id as string) ?? '';
    const start = (d.started_at as string) ?? '';
    const end = (d.finished_at as string) ?? '';
    if (!convId || !start || !end) continue;
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const startDate = start.slice(0, 10);
    const endDate = end.slice(0, 10);
    if (!startDate) continue;
    for (let d = startDate; d <= endDate; ) {
      allDates.add(d);
      const dayStart = new Date(d).getTime();
      const dayEnd = dayStart + 86400000 - 1;
      const overlapStart = Math.max(startMs, dayStart);
      const overlapEnd = Math.min(endMs, dayEnd);
      if (overlapStart <= overlapEnd) {
        const byConv = chatPeriodsByDate.get(d) ?? new Map();
        const list = byConv.get(convId) ?? [];
        list.push({ startMs: overlapStart, endMs: overlapEnd });
        byConv.set(convId, list);
        chatPeriodsByDate.set(d, byConv);
      }
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      d = next.toISOString().slice(0, 10);
    }
  }

  const skillPeriodsByDate = new Map<string, Map<string, Interval[]>>();
  for (const run of runs) {
    const convId = run.conversation_id ?? '';
    if (!convId) continue;
    const lastStep = run.steps.length > 0 ? run.steps[run.steps.length - 1] : null;
    const startMs = new Date(run.created_at).getTime();
    const endMs = lastStep?.completed_at ? new Date(lastStep.completed_at).getTime() : startMs;
    const startDate = run.created_at.slice(0, 10);
    const endDate = (lastStep?.completed_at ?? run.created_at).slice(0, 10);
    for (let d = startDate; d <= endDate; ) {
      allDates.add(d);
      const dayStart = new Date(d).getTime();
      const dayEnd = dayStart + 86400000 - 1;
      const overlapStart = Math.max(startMs, dayStart);
      const overlapEnd = Math.min(endMs, dayEnd);
      if (overlapStart <= overlapEnd) {
        const byConv = skillPeriodsByDate.get(d) ?? new Map();
        const list = byConv.get(convId) ?? [];
        list.push({ startMs: overlapStart, endMs: overlapEnd });
        byConv.set(convId, list);
        skillPeriodsByDate.set(d, byConv);
      }
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      d = next.toISOString().slice(0, 10);
    }
  }

  function mergeOverlapping(intervals: Interval[]): Interval[] {
    if (intervals.length === 0) return [];
    const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
    const merged: Interval[] = [sorted[0]!];
    for (let i = 1; i < sorted.length; i++) {
      const curr = sorted[i]!;
      const last = merged[merged.length - 1]!;
      if (curr.startMs <= last.endMs) {
        last.endMs = Math.max(last.endMs, curr.endMs);
      } else {
        merged.push(curr);
      }
    }
    return merged;
  }

  const points: ToolChartPoint[] = [];
  for (const date of Array.from(allDates).sort()) {
    const chatByConv = chatPeriodsByDate.get(date) ?? new Map();
    const skillByConv = skillPeriodsByDate.get(date) ?? new Map();
    let totalWorkMs = 0;
    let totalSkillMs = 0;
    for (const [convId, chatIntervals] of chatByConv) {
      const skillIntervals = mergeOverlapping(skillByConv.get(convId) ?? []);
      for (const chat of chatIntervals) {
        totalWorkMs += chat.endMs - chat.startMs;
        for (const skill of skillIntervals) {
          const ovStart = Math.max(chat.startMs, skill.startMs);
          const ovEnd = Math.min(chat.endMs, skill.endMs);
          if (ovStart < ovEnd) totalSkillMs += ovEnd - ovStart;
        }
      }
    }
    points.push({
      x: date,
      y: totalWorkMs > 0 ? Math.round((totalSkillMs / totalWorkMs) * 100) : 0,
    });
  }
  return points.sort((a, b) => a.x.localeCompare(b.x));
}

/**
 * Interpolate green (100) -> red (0) for a value 0..100.
 * RGB: green=#22c55e (34,197,94), red=#ef4444 (239,68,68).
 */
function colorForRate(rate: number): string {
  if (rate >= 100) return '#22c55e';
  if (rate <= 0) return '#ef4444';
  const r = Math.round(255 - (rate / 100) * (255 - 34));
  const g = Math.round(34 + (rate / 100) * (197 - 34));
  const b = Math.round(68 + (rate / 100) * (94 - 68));
  return `rgb(${r},${g},${b})`;
}

export function pageSkills(
  heatmapData: HeatmapData,
  skillsPerDayData: SkillsPerDayPoint[],
  skillsPerDayByTypeData: Map<string, ToolChartPoint[]>,
  skillSuccessRateChartData: Map<string, ToolChartPoint[]>,
  skillTimeShareChartData: ToolChartPoint[],
  entries: LogEntry[],
  totalCount: number,
  page: number,
  pageSize: number,
  sortSpec: SortSpec[],
  filterValue: string,
  filterError: string | null,
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
      return `<td class="heatmap-cell" style="background:${bg};color:${v > 50 ? '#fff' : '#333'}" title="Phase ${heatmapData.phases[pi]!.key}: ${v}%">${v}%</td>`;
    })
    .join('')}
</tr>`,
    )
    .join('');

  const heatmapHeaders = heatmapData.phases
    .map((p) => `<th class="heatmap-cell">${escapeHtml(p.key)}</th>`)
    .join('');

  const emptyMsg =
    runsCount === 0
      ? '<p>No skill-eval logs found. Run skills with skill-eval to collect data.</p>'
      : '';

  let chartsHtml = '';

  if (skillsPerDayData.length > 0 || skillsPerDayByTypeData.size > 0) {
    const maxY = Math.max(
      0,
      ...skillsPerDayData.map((p) => p.y),
      ...Array.from(skillsPerDayByTypeData.values()).flatMap((pts) => pts.map((p) => p.y)),
    );
    const maxAvg = Math.max(0, ...skillsPerDayData.map((p) => p.avgPerConv));
    const yAxisMax = maxY === 0 && maxAvg === 0 ? 1 : Math.ceil(Math.max(maxY * 1.1, maxAvg * 1.1));

    const series: { name: string; data: { x: string; y: number }[] }[] = [];
    if (skillsPerDayData.length > 0) {
      series.push({
        name: 'Skills per day',
        data: skillsPerDayData.map((p) => ({ x: p.x, y: p.y })),
      });
    }
    for (const [skillName, points] of skillsPerDayByTypeData) {
      series.push({
        name: skillName,
        data: points.map((p) => ({ x: p.x, y: p.y })),
      });
    }
    if (skillsPerDayData.length > 0) {
      series.push({
        name: 'Avg. num of skills in one session',
        data: skillsPerDayData.map((p) => ({ x: p.x, y: p.avgPerConv })),
      });
    }
    const containerId = `skills-per-day-${Math.random().toString(36).slice(2, 11)}`;
    const seriesJson = JSON.stringify(series).replace(/</g, '\\u003c');
    chartsHtml += `
<h2>Skills per day</h2>
<p class="chart-container">X = date (daily bucket). Y = number of skill runs. One line per skill plus total and avg overlay.</p>
<div id="${escapeHtml(containerId)}" class="chart-container" style="width:800px;height:400px;"></div>
<script>
(function(){
  var el=document.getElementById("${escapeHtml(containerId)}");
  if(!el||typeof ApexCharts==="undefined")return;
  var series=${seriesJson};
  var fmt=function(v){ var n=Number(v); return n===Math.round(n)?String(n):n.toFixed(1); };
  new ApexCharts(el,{
    series: series.map(function(s){ return { name: s.name, data: s.data }; }),
    chart: { type: "line", height: 400, toolbar: { show: true } },
    stroke: { curve: "straight", width: 2 },
    xaxis: { type: "datetime", labels: { datetimeUTC: false } },
    yaxis: { min: 0, max: ${yAxisMax}, tickAmount: 5, labels: { formatter: fmt } },
    tooltip: { y: { formatter: fmt } },
    legend: { position: "top", horizontalAlign: "left" }
  }).render();
})();
</script>
`;
  }

  if (skillSuccessRateChartData.size > 0) {
    const lineSeries = Array.from(skillSuccessRateChartData.entries()).map(([skill, points]) => ({
      name: skill,
      data: points.map((p) => ({ x: p.x, y: p.y })),
    }));
    const containerId = `skill-success-${Math.random().toString(36).slice(2, 11)}`;
    const lineSeriesJson = JSON.stringify(lineSeries).replace(/</g, '\\u003c');
    chartsHtml += `
<h2>Success rate over time (by skill)</h2>
<p class="chart-container">Each line = one skill. X = date (daily bucket). Y = 0–100% (runs that completed all phases / total for that skill that day).</p>
<div id="${escapeHtml(containerId)}" class="chart-container" style="width:800px;height:400px;"></div>
<script>
(function(){
  var el=document.getElementById("${escapeHtml(containerId)}");
  if(!el||typeof ApexCharts==="undefined")return;
  var series=${lineSeriesJson};
  new ApexCharts(el,{
    series: series.map(function(s){ return { name: s.name, data: s.data }; }),
    chart: { type: "line", height: 400, toolbar: { show: true } },
    stroke: { curve: "straight", width: 2 },
    xaxis: { type: "datetime", labels: { datetimeUTC: false } },
    yaxis: { min: 0, max: 100, tickAmount: 5, labels: { formatter: function(v){ return v+"%"; } } },
    legend: { position: "top", horizontalAlign: "left" }
  }).render();
})();
</script>
`;
  }

  if (skillTimeShareChartData.length > 0) {
    const timeShareSeries = [
      {
        name: 'Time in skill workflows',
        data: skillTimeShareChartData.map((p) => ({ x: p.x, y: p.y })),
      },
    ];
    const containerId = `skill-time-share-${Math.random().toString(36).slice(2, 11)}`;
    const seriesJson = JSON.stringify(timeShareSeries).replace(/</g, '\\u003c');
    chartsHtml += `
<h2>Time in skill workflows (% of work time)</h2>
<p class="chart-container">X = date (daily bucket). Y = 0–100% (time spent in active skill workflows while working / total time spent working).</p>
<div id="${escapeHtml(containerId)}" class="chart-container" style="width:800px;height:400px;"></div>
<script>
(function(){
  var el=document.getElementById("${escapeHtml(containerId)}");
  if(!el||typeof ApexCharts==="undefined")return;
  var series=${seriesJson};
  new ApexCharts(el,{
    series: series.map(function(s){ return { name: s.name, data: s.data }; }),
    chart: { type: "line", height: 400, toolbar: { show: true } },
    stroke: { curve: "straight", width: 2 },
    xaxis: { type: "datetime", labels: { datetimeUTC: false } },
    yaxis: { min: 0, max: 100, tickAmount: 5, labels: { formatter: function(v){ return v+"%"; } } },
    legend: { position: "top", horizontalAlign: "left" }
  }).render();
})();
</script>
`;
  }

  const heatmapHtml = `
<h2>Heatmap: skill × phase (success rate %)</h2>
<p class="chart-container">Each cell: % of that skill's runs that completed that phase. Green = 100%, red = 0%.</p>
<div class="chart-container">
  <table style="border-collapse:collapse">
    <thead><tr><th class="heatmap-cell">skill</th>${heatmapHeaders}</tr></thead>
    <tbody>${heatmapRows}</tbody>
  </table>
</div>`;

  const contentAboveTable = `<p>${runsCount} run${runsCount === 1 ? '' : 's'} in .cursor/logs/skills/</p>
${emptyMsg}
${chartsHtml}
${heatmapHtml}`;

  return pageLogTable(
    'Skills',
    '/skills',
    SKILL_COLUMNS,
    entries,
    totalCount,
    page,
    pageSize,
    sortSpec,
    filterValue,
    filterError,
    emptyMsg,
    "obj.skill === 'act-dev'  // JS expression, obj = log entry",
    contentAboveTable,
  );
}

export function pageError(message: string): string {
  return `${layoutStart('Error')}
<h1>Error</h1>
<p>${escapeHtml(message)}</p>
${layoutEnd}`;
}

/** Agent schema columns (design doc order). */
const AGENT_COLUMNS = [
  'finished_at',
  'started_at',
  'event',
  'subagent_type',
  'status',
  'duration',
  'conversation_id',
  'generation_id',
  'model',
  'cursor_version',
];

/** Prompt schema columns. */
const PROMPT_COLUMNS = [
  'ts',
  'conversation_id',
  'generation_id',
  'model',
  'cursor_version',
  'hook',
  'last_turn_preview',
  'context',
  'user_message',
];

/** Skill-eval run columns (for table). */
const SKILL_COLUMNS = [
  'created_at',
  'finished_at',
  'skill',
  'skill_id',
  'conversation_id',
  'phases_completed',
  'filename',
];

/** Convert SkillEvalRun to LogEntry for filter/sort/pagination. */
export function skillRunsToLogEntries(runs: SkillEvalRun[]): LogEntry[] {
  return runs.map((run, i) => {
    const lastStep = run.steps.length > 0 ? run.steps[run.steps.length - 1] : null;
    const finished_at = lastStep?.completed_at ?? run.created_at;
    return {
      id: run.filename || `skill-${i}`,
      data: {
        created_at: run.created_at,
        finished_at,
        skill: run.skill,
        skill_id: run.skill_id,
        conversation_id: run.conversation_id ?? '',
        phases_completed: run.steps.length,
        filename: run.filename,
      },
    };
  });
}

/** Chat schema columns (agent responses). */
const CHAT_COLUMNS = [
  'finished_at',
  'started_at',
  'event',
  'user_message',
  'text',
  'conversation_id',
  'generation_id',
  'model',
  'cursor_version',
];

/** Tool schema columns (union of success + failure). */
const TOOL_COLUMNS = [
  'finished_at',
  'started_at',
  'event',
  'tool_name',
  'tool_use_id',
  'cwd',
  'duration',
  'model',
  'tool_input',
  'error_message',
  'failure_type',
  'is_interrupt',
];

function formatCellValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 200 ? s.slice(0, 200) + '…' : s;
  }
  return String(v);
}

function buildLogQuery(page: number, sortParam: string, filterValue: string): string {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (sortParam) params.set('sort', sortParam);
  if (filterValue) params.set('filter', filterValue);
  const q = params.toString();
  return q ? `?${q}` : '';
}

/** Point for tool/agent success rate chart: x = date (YYYY-MM-DD), y = 0..100 */
export interface ToolChartPoint {
  x: string;
  y: number;
}

/** Point for agents-per-day chart: x = date, y = count, avgPerConv = runs / conversations */
export interface AgentsPerDayPoint {
  x: string;
  y: number;
  /** Avg. number of agent runs per conversation (count / unique conversations) for that day */
  avgPerConv: number;
}

/**
 * Compute tool success rate by day: for each (tool_name, date), success rate = successful / total.
 * Each tool gets a series of (date, rate) points.
 */
export function computeToolSuccessRateChartData(
  entries: LogEntry[],
): Map<string, ToolChartPoint[]> {
  // Aggregate: key = tool_name|date -> { success, total }
  const agg = new Map<string, { success: number; total: number }>();
  for (const entry of entries) {
    const d = entry.data as Record<string, unknown>;
    const toolName = (d.tool_name as string) ?? '?';
    const finishedAt = (d.finished_at as string) ?? '';
    const date = finishedAt.slice(0, 10);
    if (!date) continue;
    const event = (d.event as string) ?? '';
    const success = event === 'toolUse' ? 1 : 0;
    const key = `${toolName}|${date}`;
    const prev = agg.get(key) ?? { success: 0, total: 0 };
    agg.set(key, { success: prev.success + success, total: prev.total + 1 });
  }

  // Group by tool, build sorted points per tool
  const byTool = new Map<string, { date: string; success: number; total: number }[]>();
  for (const [key, v] of agg) {
    const [toolName, date] = key.split('|') as [string, string];
    const list = byTool.get(toolName) ?? [];
    list.push({ date, success: v.success, total: v.total });
    byTool.set(toolName, list);
  }

  const result = new Map<string, ToolChartPoint[]>();
  for (const [toolName, list] of byTool) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const points: ToolChartPoint[] = list.map(({ date, success, total }) => ({
      x: date,
      y: total > 0 ? Math.round((success / total) * 100) : 0,
    }));
    result.set(toolName, points);
  }
  return result;
}

/** Point for prompts-per-day chart: x = date, y = count, avgPerConv = prompts / conversations */
export interface PromptsPerDayPoint {
  x: string;
  y: number;
  /** Avg. number of prompts per conversation (count / unique conversations) for that day */
  avgPerConv: number;
}

/** Point for chats-per-day chart: x = date, y = count, avgPerConv = chats / conversations */
export interface ChatsPerDayPoint {
  x: string;
  y: number;
  /** Avg. number of chats per conversation for that day */
  avgPerConv: number;
}

/**
 * Compute chats count and avg chats per conversation by day.
 */
export function computeChatsPerDayChartData(entries: LogEntry[]): ChatsPerDayPoint[] {
  const byDate = new Map<string, { count: number; conversations: Set<string> }>();
  for (const entry of entries) {
    const d = entry.data as Record<string, unknown>;
    const finishedAt = (d.finished_at as string) ?? '';
    const date = finishedAt.slice(0, 10);
    const convId = (d.conversation_id as string) ?? '';
    if (!date) continue;
    const prev = byDate.get(date) ?? { count: 0, conversations: new Set<string>() };
    prev.count++;
    if (convId) prev.conversations.add(convId);
    byDate.set(date, prev);
  }
  return Array.from(byDate.entries())
    .map(([date, { count, conversations }]) => ({
      x: date,
      y: count,
      avgPerConv: conversations.size > 0 ? count / conversations.size : 0,
    }))
    .sort((a, b) => a.x.localeCompare(b.x));
}

/**
 * Compute prompts count and avg prompts per conversation by day.
 */
export function computePromptsPerDayChartData(entries: LogEntry[]): PromptsPerDayPoint[] {
  const byDate = new Map<string, { count: number; conversations: Set<string> }>();
  for (const entry of entries) {
    const d = entry.data as Record<string, unknown>;
    const ts = (d.ts as string) ?? '';
    const date = ts.slice(0, 10);
    const convId = (d.conversation_id as string) ?? '';
    if (!date) continue;
    const prev = byDate.get(date) ?? { count: 0, conversations: new Set<string>() };
    prev.count++;
    if (convId) prev.conversations.add(convId);
    byDate.set(date, prev);
  }
  const points = Array.from(byDate.entries())
    .map(([date, { count, conversations }]) => ({
      x: date,
      y: count,
      avgPerConv: conversations.size > 0 ? count / conversations.size : 0,
    }))
    .sort((a, b) => a.x.localeCompare(b.x));
  return points;
}

/** Point for tools-per-day chart: x = date, y = count, avgPerConv = tool calls / conversations */
export interface ToolsPerDayPoint {
  x: string;
  y: number;
  /** Avg. number of tool calls per conversation (count / unique conversations) for that day */
  avgPerConv: number;
}

/**
 * Compute tools count and avg tool calls per conversation by day.
 */
export function computeToolsPerDayChartData(entries: LogEntry[]): ToolsPerDayPoint[] {
  // Aggregate by date: total tool count and unique conversation_ids
  const byDate = new Map<string, { count: number; conversations: Set<string> }>();
  for (const entry of entries) {
    const d = entry.data as Record<string, unknown>;
    const finishedAt = (d.finished_at as string) ?? '';
    const date = finishedAt.slice(0, 10);
    const convId = (d.conversation_id as string) ?? '';
    if (!date) continue;
    const prev = byDate.get(date) ?? { count: 0, conversations: new Set<string>() };
    prev.count++;
    if (convId) prev.conversations.add(convId);
    byDate.set(date, prev);
  }

  const points = Array.from(byDate.entries())
    .map(([date, { count, conversations }]) => ({
      x: date,
      y: count,
      // Avg tool calls per conversation: count / unique_convs (avoid div by zero)
      avgPerConv: conversations.size > 0 ? count / conversations.size : 0,
    }))
    .sort((a, b) => a.x.localeCompare(b.x));
  return points;
}

/**
 * Compute tool invocations count per day, grouped by tool_name.
 * Returns Map<tool_name, {x, y}[]> for separate lines per tool.
 */
export function computeToolsPerDayByTypeChartData(
  entries: LogEntry[],
): Map<string, ToolChartPoint[]> {
  const byTypeAndDate = new Map<string, number>();
  const allDates = new Set<string>();
  for (const entry of entries) {
    const d = entry.data as Record<string, unknown>;
    const toolName = (d.tool_name as string) ?? '?';
    const finishedAt = (d.finished_at as string) ?? '';
    const date = finishedAt.slice(0, 10);
    if (!date) continue;
    allDates.add(date);
    const key = `${toolName}|${date}`;
    byTypeAndDate.set(key, (byTypeAndDate.get(key) ?? 0) + 1);
  }

  const sortedDates = Array.from(allDates).sort();
  const byType = new Map<string, Map<string, number>>();
  for (const [key, count] of byTypeAndDate) {
    const [toolName, date] = key.split('|') as [string, string];
    const inner = byType.get(toolName) ?? new Map<string, number>();
    inner.set(date, count);
    byType.set(toolName, inner);
  }

  const result = new Map<string, ToolChartPoint[]>();
  for (const [toolName, dateToCount] of byType) {
    const points: ToolChartPoint[] = sortedDates.map((date) => ({
      x: date,
      y: dateToCount.get(date) ?? 0,
    }));
    result.set(toolName, points);
  }
  return result;
}

/** Point for agents-per-day chart: x = date, y = count, avgPerConv = runs / conversations */
export interface AgentsPerDayPoint {
  x: string;
  y: number;
  /** Avg. number of agent runs per conversation (count / unique conversations) for that day */
  avgPerConv: number;
}

/**
 * Compute agent runs count and avg runs per conversation by day.
 */
export function computeAgentsPerDayChartData(entries: LogEntry[]): AgentsPerDayPoint[] {
  const byDate = new Map<string, { count: number; conversations: Set<string> }>();
  for (const entry of entries) {
    const d = entry.data as Record<string, unknown>;
    const finishedAt = (d.finished_at as string) ?? '';
    const date = finishedAt.slice(0, 10);
    const convId = (d.conversation_id as string) ?? '';
    if (!date) continue;
    const prev = byDate.get(date) ?? { count: 0, conversations: new Set<string>() };
    prev.count++;
    if (convId) prev.conversations.add(convId);
    byDate.set(date, prev);
  }
  return Array.from(byDate.entries())
    .map(([date, { count, conversations }]) => ({
      x: date,
      y: count,
      avgPerConv: conversations.size > 0 ? count / conversations.size : 0,
    }))
    .sort((a, b) => a.x.localeCompare(b.x));
}

/**
 * Compute agent success rate by day: for each (subagent_type, date), success rate = successful / total.
 * Success = status === "completed".
 */
export function computeAgentSuccessRateChartData(
  entries: LogEntry[],
): Map<string, ToolChartPoint[]> {
  const agg = new Map<string, { success: number; total: number }>();
  for (const entry of entries) {
    const d = entry.data as Record<string, unknown>;
    const agentType = (d.subagent_type as string) ?? '?';
    const finishedAt = (d.finished_at as string) ?? '';
    const date = finishedAt.slice(0, 10);
    if (!date) continue;
    const status = (d.status as string) ?? '';
    const success = status === 'completed' ? 1 : 0;
    const key = `${agentType}|${date}`;
    const prev = agg.get(key) ?? { success: 0, total: 0 };
    agg.set(key, { success: prev.success + success, total: prev.total + 1 });
  }

  const byAgent = new Map<string, { date: string; success: number; total: number }[]>();
  for (const [key, v] of agg) {
    const [agentType, date] = key.split('|') as [string, string];
    const list = byAgent.get(agentType) ?? [];
    list.push({ date, success: v.success, total: v.total });
    byAgent.set(agentType, list);
  }

  const result = new Map<string, ToolChartPoint[]>();
  for (const [agentType, list] of byAgent) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const points: ToolChartPoint[] = list.map(({ date, success, total }) => ({
      x: date,
      y: total > 0 ? Math.round((success / total) * 100) : 0,
    }));
    result.set(agentType, points);
  }
  return result;
}

/**
 * Compute agent runs count per day, grouped by subagent_type.
 * Returns Map<subagent_type, {x, y}[]> for separate lines per type.
 */
export function computeAgentsPerDayByTypeChartData(
  entries: LogEntry[],
): Map<string, ToolChartPoint[]> {
  const byTypeAndDate = new Map<string, number>();
  const allDates = new Set<string>();
  for (const entry of entries) {
    const d = entry.data as Record<string, unknown>;
    const agentType = (d.subagent_type as string) ?? '?';
    const finishedAt = (d.finished_at as string) ?? '';
    const date = finishedAt.slice(0, 10);
    if (!date) continue;
    allDates.add(date);
    const key = `${agentType}|${date}`;
    byTypeAndDate.set(key, (byTypeAndDate.get(key) ?? 0) + 1);
  }

  const sortedDates = Array.from(allDates).sort();
  const byType = new Map<string, Map<string, number>>();
  for (const [key, count] of byTypeAndDate) {
    const [agentType, date] = key.split('|') as [string, string];
    const inner = byType.get(agentType) ?? new Map<string, number>();
    inner.set(date, count);
    byType.set(agentType, inner);
  }

  const result = new Map<string, ToolChartPoint[]>();
  for (const [agentType, dateToCount] of byType) {
    const points: ToolChartPoint[] = sortedDates.map((date) => ({
      x: date,
      y: dateToCount.get(date) ?? 0,
    }));
    result.set(agentType, points);
  }
  return result;
}

/** Optional leading column with per-row links (e.g. "View" link to detail page). */
export interface LeadingColumn {
  header: string;
  href: (entry: LogEntry) => string;
  label?: string;
}

/**
 * Build a log table page (agents or tools). Reuses crawlee-one table pattern.
 * @param contentAboveTable - Optional HTML to render between filter form and table (e.g. chart)
 * @param leadingColumn - Optional column at the left with links (e.g. detail page)
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
  filterPlaceholder: string,
  contentAboveTable = '',
  leadingColumn?: LeadingColumn,
): string {
  const currentSortParam = buildSortParam(sortSpec);

  const sortByPath = new Map(sortSpec.map((s, i) => [s.path, { dir: s.dir, order: i }]));

  let tableRows = '';
  for (const entry of entries) {
    const data = entry.data as Record<string, unknown>;
    tableRows += '<tr>';
    if (leadingColumn) {
      const href = leadingColumn.href(entry);
      const label = leadingColumn.label ?? 'View';
      tableRows += `<td><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></td>`;
    }
    for (const col of columns) {
      const v = data[col];
      tableRows += `<td>${escapeHtml(formatCellValue(v))}</td>`;
    }
    tableRows += '</tr>';
  }

  let thead = '<tr>';
  if (leadingColumn) {
    thead += `<th>${escapeHtml(leadingColumn.header)}</th>`;
  }
  for (const col of columns) {
    const current = sortByPath.get(col);
    let nextSort: SortSpec[];
    let sortClass = '';
    if (!current) {
      nextSort = [{ path: col, dir: 'asc' }, ...sortSpec.filter((s) => s.path !== col)];
    } else if (current.dir === 'asc') {
      nextSort = sortSpec.map((s) => (s.path === col ? { path: col, dir: 'desc' as const } : s));
      sortClass = ' sort-asc';
    } else {
      nextSort = sortSpec.filter((s) => s.path !== col);
      sortClass = ' sort-desc';
    }
    const nextParam = buildSortParam(nextSort);
    const href = `${basePath}${buildLogQuery(1, nextParam, filterValue)}`;
    thead += `<th class="sort-header${sortClass}"><a href="${escapeHtml(href)}" style="text-decoration:none;color:inherit">${escapeHtml(col)}<span class="sort-icons"><span class="arrow-up">↑</span><span class="arrow-down">↓</span></span></a></th>`;
  }
  thead += '</tr>';

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  let pagination = '<div class="pagination">';
  if (page > 1) {
    pagination += `<a href="${escapeHtml(basePath)}${buildLogQuery(page - 1, currentSortParam, filterValue)}">Previous</a> `;
  }
  pagination += `Page ${page} of ${totalPages} (${totalCount} total)`;
  if (page < totalPages) {
    pagination += ` <a href="${escapeHtml(basePath)}${buildLogQuery(page + 1, currentSortParam, filterValue)}">Next</a>`;
  }
  pagination += '</div>';

  const filterForm =
    `<form class="filter-form" method="get" action="${escapeHtml(basePath)}">
  <textarea name="filter" placeholder="${escapeHtml(filterPlaceholder)}">${escapeHtml(filterValue)}</textarea>
  <input type="hidden" name="sort" value="${escapeHtml(currentSortParam)}">
  <input type="hidden" name="page" value="1">
  <button type="submit">Apply filter</button>
</form>` +
    (filterError ? `<p class="filter-error">Filter error: ${escapeHtml(filterError)}</p>` : '');

  return `${layoutStart(title)}
<h1>${escapeHtml(title)}</h1>
${contentAboveTable}
<h2>Table</h2>
<p>${totalCount} entr${totalCount === 1 ? 'y' : 'ies'}</p>
${totalCount === 0 ? emptyMsg : ''}
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
  filterError: string | null,
  agentChartData: Map<string, ToolChartPoint[]>,
  agentsPerDayData: AgentsPerDayPoint[],
  agentsPerDayByTypeData: Map<string, ToolChartPoint[]>,
): string {
  let chartHtml = '';

  if (agentsPerDayData.length > 0 || agentsPerDayByTypeData.size > 0) {
    const maxY = Math.max(
      0,
      ...agentsPerDayData.map((p) => p.y),
      ...Array.from(agentsPerDayByTypeData.values()).flatMap((pts) => pts.map((p) => p.y)),
    );
    const maxAvg = Math.max(0, ...agentsPerDayData.map((p) => p.avgPerConv));
    const yAxisMax = maxY === 0 && maxAvg === 0 ? 1 : Math.ceil(Math.max(maxY * 1.1, maxAvg * 1.1));

    const series: { name: string; data: { x: string; y: number }[] }[] = [];
    if (agentsPerDayData.length > 0) {
      series.push({
        name: 'Agents per day',
        data: agentsPerDayData.map((p) => ({ x: p.x, y: p.y })),
      });
    }
    for (const [agentType, points] of agentsPerDayByTypeData) {
      series.push({
        name: agentType,
        data: points.map((p) => ({ x: p.x, y: p.y })),
      });
    }
    if (agentsPerDayData.length > 0) {
      series.push({
        name: 'Avg. num of agents in one conversation',
        data: agentsPerDayData.map((p) => ({ x: p.x, y: p.avgPerConv })),
      });
    }
    const containerId = `agents-per-day-${Math.random().toString(36).slice(2, 11)}`;
    const seriesJson = JSON.stringify(series).replace(/</g, '\\u003c');
    chartHtml += `
<h2>Agents per day</h2>
<p class="chart-container">X = date (daily bucket). Y = number of agent runs. One line per subagent type plus total and avg overlay.</p>
<div id="${escapeHtml(containerId)}" class="chart-container" style="width:800px;height:400px;"></div>
<script>
(function(){
  var el=document.getElementById("${escapeHtml(containerId)}");
  if(!el||typeof ApexCharts==="undefined")return;
  var series=${seriesJson};
  var fmt=function(v){ var n=Number(v); return n===Math.round(n)?String(n):n.toFixed(1); };
  new ApexCharts(el,{
    series: series.map(function(s){ return { name: s.name, data: s.data }; }),
    chart: { type: "line", height: 400, toolbar: { show: true } },
    stroke: { curve: "straight", width: 2 },
    xaxis: { type: "datetime", labels: { datetimeUTC: false } },
    yaxis: { min: 0, max: ${yAxisMax}, tickAmount: 5, labels: { formatter: fmt } },
    tooltip: { y: { formatter: fmt } },
    legend: { position: "top", horizontalAlign: "left" }
  }).render();
})();
</script>
`;
  }

  if (agentChartData.size > 0) {
    const lineSeries = Array.from(agentChartData.entries()).map(([agentType, points]) => ({
      name: agentType,
      data: points.map((p) => ({ x: p.x, y: p.y })),
    }));
    const containerId = `agent-chart-${Math.random().toString(36).slice(2, 11)}`;
    const lineSeriesJson = JSON.stringify(lineSeries).replace(/</g, '\\u003c');
    chartHtml += `
<h2>Success rate over time (by agent)</h2>
<p class="chart-container">Each line = one subagent type. X = date (daily bucket). Y = 0–100% (completed / total for that agent type that day).</p>
<div id="${escapeHtml(containerId)}" class="chart-container" style="width:800px;height:400px;"></div>
<script>
(function(){
  var el=document.getElementById("${escapeHtml(containerId)}");
  if(!el||typeof ApexCharts==="undefined")return;
  var series=${lineSeriesJson};
  new ApexCharts(el,{
    series: series.map(function(s){ return { name: s.name, data: s.data }; }),
    chart: { type: "line", height: 400, toolbar: { show: true } },
    stroke: { curve: "straight", width: 2 },
    xaxis: { type: "datetime", labels: { datetimeUTC: false } },
    yaxis: { min: 0, max: 100, tickAmount: 5, labels: { formatter: function(v){ return v+"%"; } } },
    legend: { position: "top", horizontalAlign: "left" }
  }).render();
})();
</script>
`;
  }

  return pageLogTable(
    'Agents',
    '/agents',
    AGENT_COLUMNS,
    entries,
    totalCount,
    page,
    pageSize,
    sortSpec,
    filterValue,
    filterError,
    '<p>No agent logs found. Subagent runs are logged when subagentStop hook fires.</p>',
    "obj.subagent_type === 'architect'  // JS expression, obj = log entry",
    chartHtml,
  );
}

export function pagePrompts(
  entries: LogEntry[],
  totalCount: number,
  page: number,
  pageSize: number,
  sortSpec: SortSpec[],
  filterValue: string,
  filterError: string | null,
  promptsChartData: PromptsPerDayPoint[],
): string {
  let chartHtml = '';
  if (promptsChartData.length > 0) {
    const maxY = Math.max(0, ...promptsChartData.map((p) => p.y));
    const maxAvg = Math.max(0, ...promptsChartData.map((p) => p.avgPerConv));
    const yAxisMax = maxY === 0 && maxAvg === 0 ? 1 : Math.ceil(Math.max(maxY * 1.1, maxAvg * 1.1));
    const series = [
      { name: 'Prompts per day', data: promptsChartData.map((p) => ({ x: p.x, y: p.y })) },
      {
        name: 'Avg. num of prompts in one conversation',
        data: promptsChartData.map((p) => ({ x: p.x, y: p.avgPerConv })),
      },
    ];
    const containerId = `prompts-chart-${Math.random().toString(36).slice(2, 11)}`;
    const seriesJson = JSON.stringify(series).replace(/</g, '\\u003c');
    chartHtml = `
<h2>Prompts per day</h2>
<p class="chart-container">X = date (daily bucket). Y = number of prompts.</p>
<div id="${escapeHtml(containerId)}" class="chart-container" style="width:800px;height:400px;"></div>
<script>
(function(){
  var el=document.getElementById("${escapeHtml(containerId)}");
  if(!el||typeof ApexCharts==="undefined")return;
  var series=${seriesJson};
  var fmt=function(v){ var n=Number(v); return n===Math.round(n)?String(n):n.toFixed(1); };
  new ApexCharts(el,{
    series: series.map(function(s){ return { name: s.name, data: s.data }; }),
    chart: { type: "line", height: 400, toolbar: { show: true } },
    stroke: { curve: "straight", width: 2 },
    xaxis: { type: "datetime", labels: { datetimeUTC: false } },
    yaxis: { min: 0, max: ${yAxisMax}, tickAmount: 5, labels: { formatter: fmt } },
    tooltip: { y: { formatter: fmt } },
    legend: { position: "top", horizontalAlign: "left" }
  }).render();
})();
</script>
`;
  }

  return pageLogTable(
    'Prompts',
    '/prompts',
    PROMPT_COLUMNS,
    entries,
    totalCount,
    page,
    pageSize,
    sortSpec,
    filterValue,
    filterError,
    '<p>No prompt logs found. Prompts are logged when beforeSubmitPrompt hook fires (capture-prompts.sh).</p>',
    "obj.conversation_id === 'uuid'  // JS expression, obj = log entry",
    chartHtml,
  );
}

export function pageChats(
  entries: LogEntry[],
  totalCount: number,
  page: number,
  pageSize: number,
  sortSpec: SortSpec[],
  filterValue: string,
  filterError: string | null,
  chatsChartData: ChatsPerDayPoint[],
): string {
  let chartHtml = '';
  if (chatsChartData.length > 0) {
    const maxY = Math.max(0, ...chatsChartData.map((p) => p.y));
    const maxAvg = Math.max(0, ...chatsChartData.map((p) => p.avgPerConv));
    const yAxisMax = maxY === 0 && maxAvg === 0 ? 1 : Math.ceil(Math.max(maxY * 1.1, maxAvg * 1.1));
    const series = [
      { name: 'Chats per day', data: chatsChartData.map((p) => ({ x: p.x, y: p.y })) },
      {
        name: 'Avg. num of chats in one conversation',
        data: chatsChartData.map((p) => ({ x: p.x, y: p.avgPerConv })),
      },
    ];
    const containerId = `chats-chart-${Math.random().toString(36).slice(2, 11)}`;
    const seriesJson = JSON.stringify(series).replace(/</g, '\\u003c');
    chartHtml = `
<h2>Chats per day</h2>
<p class="chart-container">X = date (daily bucket). Y = number of agent responses.</p>
<div id="${escapeHtml(containerId)}" class="chart-container" style="width:800px;height:400px;"></div>
<script>
(function(){
  var el=document.getElementById("${escapeHtml(containerId)}");
  if(!el||typeof ApexCharts==="undefined")return;
  var series=${seriesJson};
  var fmt=function(v){ var n=Number(v); return n===Math.round(n)?String(n):n.toFixed(1); };
  new ApexCharts(el,{
    series: series.map(function(s){ return { name: s.name, data: s.data }; }),
    chart: { type: "line", height: 400, toolbar: { show: true } },
    stroke: { curve: "straight", width: 2 },
    xaxis: { type: "datetime", labels: { datetimeUTC: false } },
    yaxis: { min: 0, max: ${yAxisMax}, tickAmount: 5, labels: { formatter: fmt } },
    tooltip: { y: { formatter: fmt } },
    legend: { position: "top", horizontalAlign: "left" }
  }).render();
})();
</script>
`;
  }

  return pageLogTable(
    'Chats',
    '/chats',
    CHAT_COLUMNS,
    entries,
    totalCount,
    page,
    pageSize,
    sortSpec,
    filterValue,
    filterError,
    '<p>No chat logs found. Chats are logged when afterAgentResponse hook fires (log-chats.sh).</p>',
    "obj.conversation_id === 'uuid'  // JS expression, obj = log entry",
    chartHtml,
    {
      header: '',
      href: (e) => `/chats/${encodeURIComponent(e.id)}`,
      label: 'View',
    },
  );
}

const WATERFALL_COLORS: Record<string, string> = {
  thought: '#6366f1',
  tool: '#22c55e',
  agent: '#3b82f6',
  skill: '#f59e0b',
};

/**
 * Render waterfall chart HTML for chat detail.
 * Bars sorted by started_at; width = duration; color by type.
 */
function renderChatWaterfallChart(entries: ChatWaterfallEntry[], chatStart: string): string {
  if (entries.length === 0) {
    return `
<h2>Timeline</h2>
<p class="waterfall-chart-empty">No thoughts, tools, agents, or skills found within this chat&rsquo;s time window.</p>`;
  }

  const chatStartMs = new Date(chatStart).getTime();
  const maxEndSec = Math.max(
    ...entries.map((e) => (new Date(e.finished_at).getTime() - chatStartMs) / 1000),
  );
  const maxRounded = Math.max(1, Math.ceil(maxEndSec / 10) * 10);

  const PLOT_AREA_ESTIMATE_PX = 500;
  const MIN_BAR_PX = 3.5;
  const minBarSec = (MIN_BAR_PX / PLOT_AREA_ESTIMATE_PX) * maxRounded;

  const seriesData = entries.map((e, _i) => {
    const startSec = (new Date(e.started_at).getTime() - chatStartMs) / 1000;
    let durationSec = e.duration_ms / 1000;
    if (durationSec < minBarSec) durationSec = minBarSec;
    const endSec = startSec + durationSec;
    return {
      x: e.label.length > 60 ? e.label.slice(0, 57) + '…' : e.label,
      y: [startSec, endSec],
      fillColor: WATERFALL_COLORS[e.type] ?? '#94a3b8',
      type: e.type,
      metadata: e.metadata,
      durationSec,
      started_at: e.started_at,
      finished_at: e.finished_at,
    };
  });

  const chartHeight = Math.min(500, Math.max(200, entries.length * 24));
  const containerId = `waterfall-${Math.random().toString(36).slice(2, 11)}`;
  const seriesDataJson = JSON.stringify(
    seriesData.map(({ x, y, fillColor }) => ({ x, y, fillColor })),
  ).replace(/</g, '\\u003c');
  const customDataJson = JSON.stringify(
    seriesData.map(({ type, metadata, durationSec, started_at, finished_at }) => ({
      type,
      metadata,
      durationSec,
      started_at,
      finished_at,
    })),
  ).replace(/</g, '\\u003c');

  const tickAmount = Math.max(1, Math.min(12, maxRounded / 5));

  const legendItems = [
    ['thought', WATERFALL_COLORS.thought],
    ['tool', WATERFALL_COLORS.tool],
    ['agent', WATERFALL_COLORS.agent],
    ['skill', WATERFALL_COLORS.skill],
  ]
    .map(
      ([name, color]) =>
        `<span class="waterfall-legend-item"><span class="waterfall-legend-dot" style="background:${color}"></span>${escapeHtml(name)}</span>`,
    )
    .join(' ');

  return `
<h2>Timeline</h2>
<p class="waterfall-chart-summary">${entries.length} events — each bar: offset from chat start, width = duration. Hover for details.</p>
<p class="waterfall-legend">${legendItems}</p>
<div id="${escapeHtml(containerId)}" class="waterfall-chart" style="width:800px;height:${chartHeight}px;"></div>
<script>
(function(){
  var el=document.getElementById("${escapeHtml(containerId)}");
  if(!el||typeof ApexCharts==="undefined")return;
  var seriesData=${seriesDataJson};
  var customData=${customDataJson};
  var opts={
    series:[{data:seriesData}],
    chart:{height:${chartHeight},type:"rangeBar",toolbar:{show:true,tools:{zoom:true,zoomin:true,zoomout:true,pan:true,reset:true}}},
    plotOptions:{
      bar:{horizontal:true,distributed:true,barHeight:"70%",dataLabels:{hideOverflowingLabels:false}}
    },
    dataLabels:{
      enabled:true,
      formatter:function(val,opts){
        var d=customData[opts.dataPointIndex];
        return d?d.durationSec<1?(d.durationSec*1000).toFixed(0)+"ms":d.durationSec<60?d.durationSec.toFixed(1)+"s":Math.floor(d.durationSec/60)+"m "+(d.durationSec%60).toFixed(1)+"s":"";
      },
      style:{colors:["#f3f4f5","#fff"],fontSize:"10px"}
    },
    tooltip:{},
    xaxis:{
      type:"numeric",
      min:0,
      max:${maxRounded},
      tickAmount:${tickAmount},
      labels:{
        formatter:function(val){
          if(val<60)return val.toFixed(0)+"s";
          if(val<3600){var m=val/60;return m%1===0?m+"m":m.toFixed(1)+"m";}
          var h=val/3600;return h%1===0?h+"h":h.toFixed(1)+"h";
        }
      }
    },
    yaxis:{labels:{style:{fontSize:"10px"},maxWidth:280}},
    grid:{row:{colors:["#f3f4f5","#fff"],opacity:1}},
    legend:{show:false}
  };
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function fmtDur(s){return s<1?(s*1000).toFixed(0)+"ms":s<60?s.toFixed(1)+"s":Math.floor(s/60)+"m "+(s%60).toFixed(1)+"s";}
  opts.tooltip.custom=function(o){
    var d=customData[o.dataPointIndex];
    if(!d)return"";
    var rows=['<div class="apexcharts-tooltip-rangebar waterfall-tooltip">'];
    rows.push('<div class="tt-row"><strong>Type:</strong> '+esc(d.type)+'</div>');
    rows.push('<div class="tt-row"><strong>Duration:</strong> '+fmtDur(d.durationSec)+'</div>');
    rows.push('<div class="tt-row"><strong>Started:</strong> '+esc(d.started_at)+'</div>');
    rows.push('<div class="tt-row"><strong>Finished:</strong> '+esc(d.finished_at)+'</div>');
    if(d.metadata&&typeof d.metadata==="object"){
      for(var k in d.metadata){if(d.metadata.hasOwnProperty(k)){rows.push('<div class="tt-row"><strong>'+esc(k)+':</strong> '+esc(d.metadata[k])+'</div>');}}
    }
    rows.push('</div>');
    return rows.join('');
  };
  new ApexCharts(el,opts).render();
})();
</script>
<style>
  .waterfall-chart-summary { font-size: 0.875rem; color: #666; margin: 0 0 0.5rem; }
  .waterfall-legend { font-size: 0.8rem; color: #666; margin: 0 0 1rem; }
  .waterfall-legend-item { margin-right: 1rem; white-space: nowrap; }
  .waterfall-legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 4px; margin-right: 0.25rem; vertical-align: middle; }
  .waterfall-chart-empty { font-size: 0.875rem; color: #666; margin: 0 0 1rem; }
  .waterfall-chart { border: 1px solid #ddd; border-radius: 4px; margin-bottom: 1rem; }
  .waterfall-tooltip .tt-row { margin: 4px 0; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
</style>`;
}

/**
 * Chat detail page showing full entry data with back navigation and waterfall timeline.
 */
export function pageChatDetail(
  entry: LogEntry,
  waterfallEntries: ChatWaterfallEntry[] = [],
): string {
  const d = entry.data as Record<string, unknown>;
  const backHref = '/chats';
  const chatStart = (d.started_at as string) ?? '';

  const sections: { label: string; value: unknown }[] = [
    { label: 'ID', value: entry.id },
    { label: 'Finished at', value: d.finished_at },
    { label: 'Started at', value: d.started_at },
    { label: 'Conversation ID', value: d.conversation_id },
    { label: 'Generation ID', value: d.generation_id },
    { label: 'Model', value: d.model },
    { label: 'Cursor version', value: d.cursor_version },
    { label: 'User message', value: d.user_message },
    { label: 'Agent response (text)', value: d.text },
  ];

  const rows = sections
    .filter((s) => s.value !== undefined && s.value !== null && s.value !== '')
    .map(
      (s) =>
        `<tr><th style="text-align:left;padding-right:1rem;vertical-align:top">${escapeHtml(s.label)}</th><td style="white-space:pre-wrap;word-break:break-word">${escapeHtml(formatCellValue(s.value))}</td></tr>`,
    )
    .join('');

  const waterfallHtml = renderChatWaterfallChart(waterfallEntries, chatStart);

  return `${layoutStart('Chat detail')}
<h1>Chat detail</h1>
<p><a href="${escapeHtml(backHref)}">← Back to Chats</a></p>
<table style="margin-top:1rem">
  <tbody>${rows}</tbody>
</table>
${waterfallHtml}
${layoutEnd}`;
}

export function pageTools(
  entries: LogEntry[],
  totalCount: number,
  page: number,
  pageSize: number,
  sortSpec: SortSpec[],
  filterValue: string,
  filterError: string | null,
  toolChartData: Map<string, ToolChartPoint[]>,
  toolsPerDayData: ToolsPerDayPoint[],
  toolsPerDayByTypeData: Map<string, ToolChartPoint[]>,
): string {
  let chartHtml = '';

  if (toolsPerDayData.length > 0 || toolsPerDayByTypeData.size > 0) {
    const maxY = Math.max(
      0,
      ...toolsPerDayData.map((p) => p.y),
      ...Array.from(toolsPerDayByTypeData.values()).flatMap((pts) => pts.map((p) => p.y)),
    );
    const maxAvg = Math.max(0, ...toolsPerDayData.map((p) => p.avgPerConv));
    const yAxisMax = maxY === 0 && maxAvg === 0 ? 1 : Math.ceil(Math.max(maxY * 1.1, maxAvg * 1.1));

    const series: { name: string; data: { x: string; y: number }[] }[] = [];
    if (toolsPerDayData.length > 0) {
      series.push({
        name: 'Tools per day',
        data: toolsPerDayData.map((p) => ({ x: p.x, y: p.y })),
      });
    }
    for (const [toolName, points] of toolsPerDayByTypeData) {
      series.push({
        name: toolName,
        data: points.map((p) => ({ x: p.x, y: p.y })),
      });
    }
    if (toolsPerDayData.length > 0) {
      series.push({
        name: 'Avg. num of tools in one conversation',
        data: toolsPerDayData.map((p) => ({ x: p.x, y: p.avgPerConv })),
      });
    }
    const containerId = `tools-per-day-${Math.random().toString(36).slice(2, 11)}`;
    const seriesJson = JSON.stringify(series).replace(/</g, '\\u003c');
    chartHtml += `
<h2>Tools per day</h2>
<p class="chart-container">X = date (daily bucket). Y = number of tool invocations. One line per tool plus total and avg overlay.</p>
<div id="${escapeHtml(containerId)}" class="chart-container" style="width:800px;height:400px;"></div>
<script>
(function(){
  var el=document.getElementById("${escapeHtml(containerId)}");
  if(!el||typeof ApexCharts==="undefined")return;
  var series=${seriesJson};
  var fmt=function(v){ var n=Number(v); return n===Math.round(n)?String(n):n.toFixed(1); };
  new ApexCharts(el,{
    series: series.map(function(s){ return { name: s.name, data: s.data }; }),
    chart: { type: "line", height: 400, toolbar: { show: true } },
    stroke: { curve: "straight", width: 2 },
    xaxis: { type: "datetime", labels: { datetimeUTC: false } },
    yaxis: { min: 0, max: ${yAxisMax}, tickAmount: 5, labels: { formatter: fmt } },
    tooltip: { y: { formatter: fmt } },
    legend: { position: "top", horizontalAlign: "left" }
  }).render();
})();
</script>
`;
  }

  if (toolChartData.size > 0) {
    const lineSeries = Array.from(toolChartData.entries()).map(([toolName, points]) => ({
      name: toolName,
      data: points.map((p) => ({ x: p.x, y: p.y })),
    }));
    const containerId = `tool-chart-${Math.random().toString(36).slice(2, 11)}`;
    const lineSeriesJson = JSON.stringify(lineSeries).replace(/</g, '\\u003c');
    chartHtml += `
<h2>Success rate over time (by tool)</h2>
<p class="chart-container">Each line = one tool. X = date (daily bucket). Y = 0–100% (successful calls / total calls for that tool that day).</p>
<div id="${escapeHtml(containerId)}" class="chart-container" style="width:800px;height:400px;"></div>
<script>
(function(){
  var el=document.getElementById("${escapeHtml(containerId)}");
  if(!el||typeof ApexCharts==="undefined")return;
  var series=${lineSeriesJson};
  new ApexCharts(el,{
    series: series.map(function(s){ return { name: s.name, data: s.data }; }),
    chart: { type: "line", height: 400, toolbar: { show: true } },
    stroke: { curve: "straight", width: 2 },
    xaxis: { type: "datetime", labels: { datetimeUTC: false } },
    yaxis: { min: 0, max: 100, tickAmount: 5, labels: { formatter: function(v){ return v+"%"; } } },
    legend: { position: "top", horizontalAlign: "left" }
  }).render();
})();
</script>
`;
  }

  return pageLogTable(
    'Tools',
    '/tools',
    TOOL_COLUMNS,
    entries,
    totalCount,
    page,
    pageSize,
    sortSpec,
    filterValue,
    filterError,
    '<p>No tool logs found. Tool invocations are logged when postToolUse/postToolUseFailure hooks fire.</p>',
    "obj.tool_name === 'Shell'  // JS expression, obj = log entry",
    chartHtml,
  );
}

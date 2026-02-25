/**
 * Express server for the skill-eval dashboard.
 *
 * Pages: Skills (heatmap + line chart), Agents (subagent runs), Tools (tool invocations), Prompts (user prompts).
 */

import path from 'node:path';

import express from 'express';

import { getSkillPhasesMap } from '../validate/skill-phases.js';
import {
  computeAgentSuccessRateChartData,
  computeAgentsPerDayByTypeChartData,
  computeAgentsPerDayChartData,
  computeChatsPerDayChartData,
  computeHeatmapData,
  computePromptsPerDayChartData,
  computeSkillSuccessRateChartData,
  computeSkillTimeShareChartData,
  computeSkillsPerDayByTypeChartData,
  computeSkillsPerDayChartData,
  computeToolSuccessRateChartData,
  computeToolsPerDayByTypeChartData,
  computeToolsPerDayChartData,
  pageAgents,
  pageChatDetail,
  pageChats,
  pageError,
  pagePrompts,
  pageSkills,
  pageTools,
  skillRunsToLogEntries,
} from './pages.js';
import { createFilterFn, validateFilterScript } from './filter.js';
import {
  getChatWaterfallEntries,
  getLogEntriesPageWithSort,
  loadAgentLogs,
  loadChatLogs,
  loadPromptLogs,
  loadSkillEvalLogs,
  loadThoughtLogs,
  loadToolLogs,
  parseSortParam,
} from './storage.js';

const LOG_DIR = '.cursor/logs/skills';
const AGENTS_LOG_DIR = '.cursor/logs/agents';
const CHATS_LOG_DIR = '.cursor/logs/chats';
const THOUGHTS_LOG_DIR = '.cursor/logs/thoughts';
const TOOLS_LOG_DIR = '.cursor/logs/tools';
const PROMPTS_LOG_DIR = '.cursor/logs/prompts';
const SKILLS_DIR = '.cursor/skills';
const PAGE_SIZE = 100;
const DEFAULT_SORT_AGENTS_TOOLS = '-finished_at';
const DEFAULT_SORT_PROMPTS = '-ts';
const DEFAULT_SORT_SKILLS = '-created_at';

function createPreviewServer(repoRoot: string): express.Application {
  const app = express();
  const logDir = path.join(repoRoot, LOG_DIR);
  const agentsLogDir = path.join(repoRoot, AGENTS_LOG_DIR);
  const chatsLogDir = path.join(repoRoot, CHATS_LOG_DIR);
  const thoughtsLogDir = path.join(repoRoot, THOUGHTS_LOG_DIR);
  const toolsLogDir = path.join(repoRoot, TOOLS_LOG_DIR);
  const promptsLogDir = path.join(repoRoot, PROMPTS_LOG_DIR);
  const skillsDir = path.join(repoRoot, SKILLS_DIR);

  app.get('/', (_req, res) => {
    res.redirect(302, '/skills');
  });

  app.get('/agents', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const sortParam = (req.query.sort as string) || DEFAULT_SORT_AGENTS_TOOLS;
    const filterParam = (req.query.filter as string) || '';
    const filterScript = typeof filterParam === 'string' ? filterParam.trim() : '';
    const sortSpec = parseSortParam(sortParam);

    let filterFn: ((e: { id: string; data: object }) => boolean) | undefined;
    let filterError: string | null = null;
    if (filterScript) {
      filterError = validateFilterScript(filterScript);
      if (!filterError) {
        try {
          filterFn = createFilterFn(filterScript);
        } catch (e) {
          filterError = e instanceof Error ? e.message : String(e);
        }
      }
    }

    try {
      const allEntries = await loadAgentLogs(agentsLogDir);
      const offset = (page - 1) * PAGE_SIZE;
      const { entries, totalCount } = getLogEntriesPageWithSort(
        allEntries,
        offset,
        PAGE_SIZE,
        sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
        filterFn,
      );

      const agentChartData = computeAgentSuccessRateChartData(allEntries);
      const agentsPerDayData = computeAgentsPerDayChartData(allEntries);
      const agentsPerDayByTypeData = computeAgentsPerDayByTypeChartData(allEntries);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(
        pageAgents(
          entries,
          totalCount,
          page,
          PAGE_SIZE,
          sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
          filterScript,
          filterError,
          agentChartData,
          agentsPerDayData,
          agentsPerDayByTypeData,
        ),
      );
    } catch (err) {
      res.status(500).send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  app.get('/tools', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const sortParam = (req.query.sort as string) || DEFAULT_SORT_AGENTS_TOOLS;
    const filterParam = (req.query.filter as string) || '';
    const filterScript = typeof filterParam === 'string' ? filterParam.trim() : '';
    const sortSpec = parseSortParam(sortParam);

    let filterFn: ((e: { id: string; data: object }) => boolean) | undefined;
    let filterError: string | null = null;
    if (filterScript) {
      filterError = validateFilterScript(filterScript);
      if (!filterError) {
        try {
          filterFn = createFilterFn(filterScript);
        } catch (e) {
          filterError = e instanceof Error ? e.message : String(e);
        }
      }
    }

    try {
      const allEntries = await loadToolLogs(toolsLogDir);
      const offset = (page - 1) * PAGE_SIZE;
      const { entries, totalCount } = getLogEntriesPageWithSort(
        allEntries,
        offset,
        PAGE_SIZE,
        sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
        filterFn,
      );

      const toolChartData = computeToolSuccessRateChartData(allEntries);
      const toolsPerDayData = computeToolsPerDayChartData(allEntries);
      const toolsPerDayByTypeData = computeToolsPerDayByTypeChartData(allEntries);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(
        pageTools(
          entries,
          totalCount,
          page,
          PAGE_SIZE,
          sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
          filterScript,
          filterError,
          toolChartData,
          toolsPerDayData,
          toolsPerDayByTypeData,
        ),
      );
    } catch (err) {
      res.status(500).send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  app.get('/prompts', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const sortParam = (req.query.sort as string) || DEFAULT_SORT_PROMPTS;
    const filterParam = (req.query.filter as string) || '';
    const filterScript = typeof filterParam === 'string' ? filterParam.trim() : '';
    const sortSpec = parseSortParam(sortParam);

    let filterFn: ((e: { id: string; data: object }) => boolean) | undefined;
    let filterError: string | null = null;
    if (filterScript) {
      filterError = validateFilterScript(filterScript);
      if (!filterError) {
        try {
          filterFn = createFilterFn(filterScript);
        } catch (e) {
          filterError = e instanceof Error ? e.message : String(e);
        }
      }
    }

    try {
      const allEntries = await loadPromptLogs(promptsLogDir);
      const offset = (page - 1) * PAGE_SIZE;
      const { entries, totalCount } = getLogEntriesPageWithSort(
        allEntries,
        offset,
        PAGE_SIZE,
        sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_PROMPTS),
        filterFn,
      );

      const promptsChartData = computePromptsPerDayChartData(allEntries);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(
        pagePrompts(
          entries,
          totalCount,
          page,
          PAGE_SIZE,
          sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_PROMPTS),
          filterScript,
          filterError,
          promptsChartData,
        ),
      );
    } catch (err) {
      res.status(500).send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  app.get('/chats/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) {
      res.redirect(302, '/chats');
      return;
    }
    try {
      const [allChats, thoughts, tools, agents, skills] = await Promise.all([
        loadChatLogs(chatsLogDir, promptsLogDir),
        loadThoughtLogs(thoughtsLogDir),
        loadToolLogs(toolsLogDir),
        loadAgentLogs(agentsLogDir),
        loadSkillEvalLogs(logDir),
      ]);
      const entry = allChats.find((e) => e.id === id);
      if (!entry) {
        res.status(404).send(pageError(`Chat not found: ${id}`));
        return;
      }
      const waterfallEntries = getChatWaterfallEntries(entry, thoughts, tools, agents, skills);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(pageChatDetail(entry, waterfallEntries));
    } catch (err) {
      res.status(500).send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  app.get('/chats', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const sortParam = (req.query.sort as string) || DEFAULT_SORT_AGENTS_TOOLS;
    const filterParam = (req.query.filter as string) || '';
    const filterScript = typeof filterParam === 'string' ? filterParam.trim() : '';
    const sortSpec = parseSortParam(sortParam);

    let filterFn: ((e: { id: string; data: object }) => boolean) | undefined;
    let filterError: string | null = null;
    if (filterScript) {
      filterError = validateFilterScript(filterScript);
      if (!filterError) {
        try {
          filterFn = createFilterFn(filterScript);
        } catch (e) {
          filterError = e instanceof Error ? e.message : String(e);
        }
      }
    }

    try {
      const allEntries = await loadChatLogs(chatsLogDir, promptsLogDir);
      const offset = (page - 1) * PAGE_SIZE;
      const { entries, totalCount } = getLogEntriesPageWithSort(
        allEntries,
        offset,
        PAGE_SIZE,
        sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
        filterFn,
      );

      const chatsChartData = computeChatsPerDayChartData(allEntries);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(
        pageChats(
          entries,
          totalCount,
          page,
          PAGE_SIZE,
          sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
          filterScript,
          filterError,
          chatsChartData,
        ),
      );
    } catch (err) {
      res.status(500).send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  app.get('/skills', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const sortParam = (req.query.sort as string) || DEFAULT_SORT_SKILLS;
    const filterParam = (req.query.filter as string) || '';
    const filterScript = typeof filterParam === 'string' ? filterParam.trim() : '';
    const sortSpec = parseSortParam(sortParam);

    let filterFn: ((e: { id: string; data: object }) => boolean) | undefined;
    let filterError: string | null = null;
    if (filterScript) {
      filterError = validateFilterScript(filterScript);
      if (!filterError) {
        try {
          filterFn = createFilterFn(filterScript);
        } catch (e) {
          filterError = e instanceof Error ? e.message : String(e);
        }
      }
    }

    try {
      const [runs, skillPhasesMap, chats] = await Promise.all([
        loadSkillEvalLogs(logDir),
        getSkillPhasesMap(skillsDir),
        loadChatLogs(chatsLogDir, promptsLogDir),
      ]);

      const allEntries = skillRunsToLogEntries(runs);
      const offset = (page - 1) * PAGE_SIZE;
      const { entries, totalCount } = getLogEntriesPageWithSort(
        allEntries,
        offset,
        PAGE_SIZE,
        sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_SKILLS),
        filterFn,
      );

      const heatmapData = computeHeatmapData(runs, skillPhasesMap);
      const skillsPerDayData = computeSkillsPerDayChartData(runs);
      const skillsPerDayByTypeData = computeSkillsPerDayByTypeChartData(runs);
      const skillSuccessRateChartData = computeSkillSuccessRateChartData(runs, skillPhasesMap);
      const skillTimeShareChartData = computeSkillTimeShareChartData(chats, runs);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(
        pageSkills(
          heatmapData,
          skillsPerDayData,
          skillsPerDayByTypeData,
          skillSuccessRateChartData,
          skillTimeShareChartData,
          entries,
          totalCount,
          page,
          PAGE_SIZE,
          sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_SKILLS),
          filterScript,
          filterError,
          runs.length,
        ),
      );
    } catch (err) {
      res.status(500).send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  return app;
}

export interface PreviewServerOptions {
  port?: number;
  repoRoot?: string;
}

/**
 * Start the preview server.
 * Serves the skill-eval dashboard at /skills.
 */
export async function startPreviewServer(
  options: PreviewServerOptions = {},
): Promise<{ port: number; url: string }> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const port = options.port ?? 3040;

  const app = createPreviewServer(repoRoot);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(
        `Preview dashboard: ${url}/skills  ${url}/agents  ${url}/tools  ${url}/prompts  ${url}/chats`,
      );
      resolve({ port, url });
    });
    server.on('error', reject);
  });
}

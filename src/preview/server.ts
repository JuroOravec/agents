/**
 * Fastify server for the skill-eval dashboard.
 *
 * Pages: Skills (heatmap + line chart), Agents (subagent runs), Tools (tool invocations), Prompts (user prompts).
 */

import path from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';

import { getSkillPhasesMap } from '../engine/validate/skill-phases.js';
import { createFilterFn, validateFilterScript } from './filter.js';
import {
  computeAgentsPerDayByTypeChartData,
  computeAgentsPerDayChartData,
  computeAgentSuccessRateChartData,
  computeChatsPerDayChartData,
  computeHeatmapData,
  computePromptsPerDayChartData,
  computeSkillsPerDayByTypeChartData,
  computeSkillsPerDayChartData,
  computeSkillSuccessRateChartData,
  computeSkillTimeShareChartData,
  computeToolsPerDayByTypeChartData,
  computeToolsPerDayChartData,
  computeToolSuccessRateChartData,
  pageAgents,
  pageChatDetail,
  pageChats,
  pageError,
  pagePrompts,
  pageSkills,
  pageTools,
  skillRunsToLogEntries,
} from './pages.js';
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

/** JSON Schema for list routes (agents, tools, prompts, chats, skills). */
const listQuerySchema = {
  type: 'object',
  properties: {
    page: { type: 'string' },
    sort: { type: 'string' },
    filter: { type: 'string' },
  },
  additionalProperties: false,
} as const;

/** JSON Schema for /chats/:id route. */
const chatIdParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
  },
  required: ['id'],
  additionalProperties: false,
} as const;

export function createPreviewServer(repoRoot: string): FastifyInstance {
  const fastify = Fastify({ logger: false });
  const logDir = path.join(repoRoot, LOG_DIR);
  const agentsLogDir = path.join(repoRoot, AGENTS_LOG_DIR);
  const chatsLogDir = path.join(repoRoot, CHATS_LOG_DIR);
  const thoughtsLogDir = path.join(repoRoot, THOUGHTS_LOG_DIR);
  const toolsLogDir = path.join(repoRoot, TOOLS_LOG_DIR);
  const promptsLogDir = path.join(repoRoot, PROMPTS_LOG_DIR);
  const skillsDir = path.join(repoRoot, SKILLS_DIR);

  fastify.get('/', (_request, reply) => {
    return reply.redirect('/skills', 302);
  });

  fastify.get<{
    Querystring: { page?: string; sort?: string; filter?: string };
  }>('/agents', { schema: { querystring: listQuerySchema } }, async (request, reply) => {
    const page = Math.max(1, parseInt(request.query.page ?? '', 10) || 1);
    const sortParam = request.query.sort ?? DEFAULT_SORT_AGENTS_TOOLS;
    const filterParam = request.query.filter ?? '';
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
      const { entries, totalCount } = getLogEntriesPageWithSort({
        allEntries,
        offset,
        limit: PAGE_SIZE,
        sortSpec: sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
        filterFn,
      });

      const agentChartData = computeAgentSuccessRateChartData(allEntries);
      const agentsPerDayData = computeAgentsPerDayChartData(allEntries);
      const agentsPerDayByTypeData = computeAgentsPerDayByTypeChartData(allEntries);

      return reply.type('text/html; charset=utf-8').send(
        pageAgents({
          entries,
          totalCount,
          page,
          pageSize: PAGE_SIZE,
          sortSpec: sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
          filterValue: filterScript,
          filterError,
          agentChartData,
          agentsPerDayData,
          agentsPerDayByTypeData,
        }),
      );
    } catch (err) {
      return reply
        .status(500)
        .type('text/html; charset=utf-8')
        .send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  fastify.get<{
    Querystring: { page?: string; sort?: string; filter?: string };
  }>('/tools', { schema: { querystring: listQuerySchema } }, async (request, reply) => {
    const page = Math.max(1, parseInt(request.query.page ?? '', 10) || 1);
    const sortParam = request.query.sort ?? DEFAULT_SORT_AGENTS_TOOLS;
    const filterParam = request.query.filter ?? '';
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
      const { entries, totalCount } = getLogEntriesPageWithSort({
        allEntries,
        offset,
        limit: PAGE_SIZE,
        sortSpec: sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
        filterFn,
      });

      const toolChartData = computeToolSuccessRateChartData(allEntries);
      const toolsPerDayData = computeToolsPerDayChartData(allEntries);
      const toolsPerDayByTypeData = computeToolsPerDayByTypeChartData(allEntries);

      return reply.type('text/html; charset=utf-8').send(
        pageTools({
          entries,
          totalCount,
          page,
          pageSize: PAGE_SIZE,
          sortSpec: sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
          filterValue: filterScript,
          filterError,
          toolChartData,
          toolsPerDayData,
          toolsPerDayByTypeData,
        }),
      );
    } catch (err) {
      return reply
        .status(500)
        .type('text/html; charset=utf-8')
        .send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  fastify.get<{
    Querystring: { page?: string; sort?: string; filter?: string };
  }>('/prompts', { schema: { querystring: listQuerySchema } }, async (request, reply) => {
    const page = Math.max(1, parseInt(request.query.page ?? '', 10) || 1);
    const sortParam = request.query.sort ?? DEFAULT_SORT_PROMPTS;
    const filterParam = request.query.filter ?? '';
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
      const { entries, totalCount } = getLogEntriesPageWithSort({
        allEntries,
        offset,
        limit: PAGE_SIZE,
        sortSpec: sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_PROMPTS),
        filterFn,
      });

      const promptsChartData = computePromptsPerDayChartData(allEntries);

      return reply.type('text/html; charset=utf-8').send(
        pagePrompts({
          entries,
          totalCount,
          page,
          pageSize: PAGE_SIZE,
          sortSpec: sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_PROMPTS),
          filterValue: filterScript,
          filterError,
          promptsChartData,
        }),
      );
    } catch (err) {
      return reply
        .status(500)
        .type('text/html; charset=utf-8')
        .send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  fastify.get<{
    Params: { id: string };
  }>('/chats/:id', { schema: { params: chatIdParamsSchema } }, async (request, reply) => {
    const { id } = request.params;
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
        return reply
          .status(404)
          .type('text/html; charset=utf-8')
          .send(pageError(`Chat not found: ${id}`));
      }
      const waterfallEntries = getChatWaterfallEntries({
        chat: entry,
        thoughts,
        tools,
        agents,
        skills,
      });
      return reply.type('text/html; charset=utf-8').send(pageChatDetail(entry, waterfallEntries));
    } catch (err) {
      return reply
        .status(500)
        .type('text/html; charset=utf-8')
        .send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  fastify.get<{
    Querystring: { page?: string; sort?: string; filter?: string };
  }>('/chats', { schema: { querystring: listQuerySchema } }, async (request, reply) => {
    const page = Math.max(1, parseInt(request.query.page ?? '', 10) || 1);
    const sortParam = request.query.sort ?? DEFAULT_SORT_AGENTS_TOOLS;
    const filterParam = request.query.filter ?? '';
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
      const { entries, totalCount } = getLogEntriesPageWithSort({
        allEntries,
        offset,
        limit: PAGE_SIZE,
        sortSpec: sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
        filterFn,
      });

      const chatsChartData = computeChatsPerDayChartData(allEntries);

      return reply.type('text/html; charset=utf-8').send(
        pageChats({
          entries,
          totalCount,
          page,
          pageSize: PAGE_SIZE,
          sortSpec: sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
          filterValue: filterScript,
          filterError,
          chatsChartData,
        }),
      );
    } catch (err) {
      return reply
        .status(500)
        .type('text/html; charset=utf-8')
        .send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  fastify.get<{
    Querystring: { page?: string; sort?: string; filter?: string };
  }>('/skills', { schema: { querystring: listQuerySchema } }, async (request, reply) => {
    const page = Math.max(1, parseInt(request.query.page ?? '', 10) || 1);
    const sortParam = request.query.sort ?? DEFAULT_SORT_SKILLS;
    const filterParam = request.query.filter ?? '';
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
      const { entries, totalCount } = getLogEntriesPageWithSort({
        allEntries,
        offset,
        limit: PAGE_SIZE,
        sortSpec: sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_SKILLS),
        filterFn,
      });

      const heatmapData = computeHeatmapData(runs, skillPhasesMap);
      const skillsPerDayData = computeSkillsPerDayChartData(runs);
      const skillsPerDayByTypeData = computeSkillsPerDayByTypeChartData(runs);
      const skillSuccessRateChartData = computeSkillSuccessRateChartData(runs, skillPhasesMap);
      const skillTimeShareChartData = computeSkillTimeShareChartData(chats, runs);

      return reply.type('text/html; charset=utf-8').send(
        pageSkills({
          heatmapData,
          skillsPerDayData,
          skillsPerDayByTypeData,
          skillSuccessRateChartData,
          skillTimeShareChartData,
          entries,
          totalCount,
          page,
          pageSize: PAGE_SIZE,
          sortSpec: sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_SKILLS),
          filterValue: filterScript,
          filterError,
          runsCount: runs.length,
        }),
      );
    } catch (err) {
      return reply
        .status(500)
        .type('text/html; charset=utf-8')
        .send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  return fastify;
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

  const fastify = createPreviewServer(repoRoot);

  await fastify.listen({ port });
  const url = `http://localhost:${port}`;
  console.log(
    `Preview dashboard: ${url}/skills  ${url}/agents  ${url}/tools  ${url}/prompts  ${url}/chats`,
  );
  return { port, url };
}

/**
 * Express server for the skill-eval dashboard.
 *
 * Pages: Skills (heatmap + line chart), Agents (subagent runs), Tools (tool invocations), Prompts (user prompts).
 */

import path from "node:path";

import express from "express";

import { getSkillPhasesMap } from "../validate/skill-phases.js";
import {
  computeHeatmapData,
  computeLineChartData,
  pageAgents,
  pageError,
  pagePrompts,
  pageSkills,
  pageTools,
} from "./pages.js";
import { createFilterFn, validateFilterScript } from "./filter.js";
import {
  getLogEntriesPageWithSort,
  loadAgentLogs,
  loadPromptLogs,
  loadSkillEvalLogs,
  loadToolLogs,
  parseSortParam,
} from "./storage.js";

const LOG_DIR = ".cursor/logs/skills";
const AGENTS_LOG_DIR = ".cursor/logs/agents";
const TOOLS_LOG_DIR = ".cursor/logs/tools";
const PROMPTS_LOG_DIR = ".cursor/logs/prompts";
const SKILLS_DIR = ".cursor/skills";
const PAGE_SIZE = 100;
const DEFAULT_SORT_AGENTS_TOOLS = "-finished_at";
const DEFAULT_SORT_PROMPTS = "-ts";

function createPreviewServer(repoRoot: string): express.Application {
  const app = express();
  const logDir = path.join(repoRoot, LOG_DIR);
  const agentsLogDir = path.join(repoRoot, AGENTS_LOG_DIR);
  const toolsLogDir = path.join(repoRoot, TOOLS_LOG_DIR);
  const promptsLogDir = path.join(repoRoot, PROMPTS_LOG_DIR);
  const skillsDir = path.join(repoRoot, SKILLS_DIR);

  app.get("/", (_req, res) => {
    res.redirect(302, "/skills");
  });

  app.get("/agents", async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const sortParam = (req.query.sort as string) || DEFAULT_SORT_AGENTS_TOOLS;
    const filterParam = (req.query.filter as string) || "";
    const filterScript = typeof filterParam === "string" ? filterParam.trim() : "";
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
        filterFn
      );

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(
        pageAgents(
          entries,
          totalCount,
          page,
          PAGE_SIZE,
          sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
          filterScript,
          filterError
        )
      );
    } catch (err) {
      res
        .status(500)
        .send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  app.get("/tools", async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const sortParam = (req.query.sort as string) || DEFAULT_SORT_AGENTS_TOOLS;
    const filterParam = (req.query.filter as string) || "";
    const filterScript = typeof filterParam === "string" ? filterParam.trim() : "";
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
        filterFn
      );

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(
        pageTools(
          entries,
          totalCount,
          page,
          PAGE_SIZE,
          sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_AGENTS_TOOLS),
          filterScript,
          filterError
        )
      );
    } catch (err) {
      res
        .status(500)
        .send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  app.get("/prompts", async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const sortParam = (req.query.sort as string) || DEFAULT_SORT_PROMPTS;
    const filterParam = (req.query.filter as string) || "";
    const filterScript = typeof filterParam === "string" ? filterParam.trim() : "";
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
        filterFn
      );

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(
        pagePrompts(
          entries,
          totalCount,
          page,
          PAGE_SIZE,
          sortSpec.length > 0 ? sortSpec : parseSortParam(DEFAULT_SORT_PROMPTS),
          filterScript,
          filterError
        )
      );
    } catch (err) {
      res
        .status(500)
        .send(pageError(err instanceof Error ? err.message : String(err)));
    }
  });

  app.get("/skills", async (_req, res) => {
    try {
      const [runs, skillPhasesMap] = await Promise.all([
        loadSkillEvalLogs(logDir),
        getSkillPhasesMap(skillsDir),
      ]);

      const heatmapData = computeHeatmapData(runs, skillPhasesMap);
      const lineChartData = computeLineChartData(runs, skillPhasesMap);

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(pageSkills(heatmapData, lineChartData, runs.length));
    } catch (err) {
      res
        .status(500)
        .send(pageError(err instanceof Error ? err.message : String(err)));
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
      console.log(`Preview dashboard: ${url}/skills  ${url}/agents  ${url}/tools  ${url}/prompts`);
      resolve({ port, url });
    });
    server.on("error", reject);
  });
}

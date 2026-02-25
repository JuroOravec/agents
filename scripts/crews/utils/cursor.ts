#!/usr/bin/env node
/**
 * LangChain ChatModel wrapper that invokes Cursor Agent CLI.
 *
 * Spawns `cursor-agent -p "prompt" --output-format text --mode ask` (or equivalent)
 * and returns the stdout as the model response. Uses Composer 1.5 or the default
 * Cursor model when no --model is specified.
 *
 * Use with KaibanJS agents via llmInstance:
 *
 *   import { ChatCursorCLI } from "./utils/cursor.js";
 *   const llm = new ChatCursorCLI({ model: "composer-1.5" });
 *   const agent = new Agent({ name, role, goal, background, llmInstance: llm });
 *
 * Prerequisites: Cursor Agent CLI installed (`curl https://cursor.com/install -fsS | bash`)
 * and logged in (`cursor-agent login`). Verify with `cursor-agent status`.
 *
 * Pros: Uses Cursor subscription (no API keys), works offline once authenticated.
 * Cons: One process per request (slower than HTTP), large prompts may hit OS argv limits (~256KB).
 *
 * Used by crews when CREW_MODEL_SMART=cursor:composer-1-5 (see config.ts).
 *
 * Mode: "ask" = read-only Q&A (no file edits). "plan" = planning only. Omit = full agent with tools.
 * For PRD review and similar tasks, use mode "ask".
 *
 * Troubleshooting:
 *   - Workspace Trust: pass --trust (default) for headless; set trustWorkspace: false for interactive.
 *   - "cursor-agent: command not found" → install CLI, add ~/.local/bin to PATH.
 *   - "No models available" → run cursor-agent login.
 *   - Timeout → increase timeoutMs. Large prompts → split document or use HTTP-based LLM.
 */

import { spawn } from "node:child_process";

import type { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatGeneration, ChatResult } from "@langchain/core/outputs";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";

export interface ChatCursorCLIOptions {
  /** CLI binary: "cursor-agent" or "agent" or full path */
  binary?: string;
  /** Model name for --model flag (e.g. "composer-1.5", "gpt-5.2"). Omit to use Cursor default. */
  model?: string;
  /** Mode: "ask" for read-only Q&A (no edits), "plan" for planning, omit for agent (full tools) */
  mode?: "ask" | "plan";
  /** Timeout in ms before killing the process. Default 120000 (2 min). */
  timeoutMs?: number;
  /** Working directory for the CLI (defaults to process.cwd()) */
  workspace?: string;
  /** Pass --trust to skip workspace trust prompt (required for headless). Default true. */
  trustWorkspace?: boolean;
  /** Passed to BaseChatModel (callbacks, tags, etc.) */
  callbacks?: BaseChatModel["callbacks"];
  verbose?: boolean;
}

const DEFAULT_BINARY = "cursor-agent";
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * ChatModel that invokes Cursor Agent CLI for each request.
 *
 * Options: binary, model, mode ("ask"|"plan"), timeoutMs (default 120000), workspace,
 * trustWorkspace (default true for headless). See ChatCursorCLIOptions.
 */
export class ChatCursorCLI extends BaseChatModel<BaseChatModelCallOptions> {
  lc_namespace = ["agents", "scripts", "crews", "utils", "cursor"];

  binary: string;
  model?: string;
  mode?: "ask" | "plan";
  timeoutMs: number;
  workspace?: string;
  trustWorkspace: boolean;

  constructor(options: ChatCursorCLIOptions = {}) {
    super({
      callbacks: options.callbacks,
      verbose: options.verbose,
    });
    this.binary = options.binary ?? DEFAULT_BINARY;
    this.model = options.model;
    this.mode = options.mode ?? "ask";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.workspace = options.workspace;
    this.trustWorkspace = options.trustWorkspace ?? true;
  }

  _llmType(): string {
    return "cursor-cli";
  }

  /** Convert LangChain messages to a single prompt for the CLI. */
  private messagesToPrompt(messages: BaseMessage[]): string {
    const parts: string[] = [];
    for (const m of messages) {
      if (m instanceof SystemMessage) {
        parts.push(`[System]: ${m.content}`);
      } else if (m instanceof HumanMessage) {
        parts.push(`[User]: ${m.content}`);
      } else if (m instanceof AIMessage) {
        parts.push(`[Assistant]: ${m.content}`);
      } else {
        parts.push(String(m.content));
      }
    }
    return parts.join("\n\n");
  }

  /** Run cursor-agent and return stdout. */
  private async runCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args: string[] = [
        "-p",
        prompt,
        "--output-format",
        "text",
        "--mode",
        this.mode ?? "ask",
      ];
      if (this.trustWorkspace) args.push("--trust");
      if (this.model) args.push("--model", this.model);
      if (this.workspace) args.push("--workspace", this.workspace);

      const proc = spawn(this.binary, args, {
        stdio: "pipe",
        cwd: this.workspace ?? process.cwd(),
      });

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error(`Cursor CLI timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      proc.on("close", (code, signal) => {
        clearTimeout(timer);
        if (code !== 0 && code !== null) {
          reject(
            new Error(
              `Cursor CLI exited ${code}${signal ? ` (${signal})` : ""}. stderr: ${stderr.slice(0, 500)}`
            )
          );
        } else {
          resolve(stdout.trim());
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.stdin.end();
    });
  }

  async _generate(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const prompt = this.messagesToPrompt(messages);
    const text = await this.runCli(prompt);

    const message = new AIMessage(text);
    const generation: ChatGeneration = { message, text };

    await runManager?.handleLLMEnd?.({ generations: [[generation]] });

    return {
      generations: [generation],
      llmOutput: { model: this.model ?? "cursor-default" },
    };
  }
}

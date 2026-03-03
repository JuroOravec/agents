# Design: Iteration Loop (Reviewer + Worker) on Mastra

**Related:** `docs/features/ai-crews/crew_ai.md`, `src/crews/prd-review.ts`

---

## Problem

The current `prd-review` crew is a **single-pass pipeline**: review → rewrite → done. There is no mechanism to validate whether the output meets quality criteria, no iteration if it falls short, and no audit trail of what changed and why.

We want a **multi-round collaboration loop** where:

- A **Reviewer** finds issues and asks the Worker to address them.
- A **Worker** (Thinker + Coder sidecar) implements those changes in isolation.
- The loop repeats until the Reviewer approves or a `maxRounds` cap is hit.
- After approval, the Reviewer checks whether the work constitutes a novel reusable process and files a GitHub issue if so.
- Finally, the orchestrator safely hands the code back to you, optionally auto-merging it into your current working branch.

---

## Roles

### Reviewer (smart model)

Plays the role of a senior reviewer / tech lead. Communicates only with the Worker as a whole—it is not aware that the Worker is internally split into Thinker + Coder.

**Deterministic validation before each round:** The orchestrator (worker) runs `npm run check:agent` programmatically in the worktree before invoking the Reviewer. When validation **fails**, we bypass the Reviewer entirely and synthesize a NEEDS_WORK issue list from the check output, sending it directly to the Worker — no LLM call, faster feedback. When validation **passes**, the Reviewer runs as usual with the check result in its prompt.

**Responsibilities:**

- Produce a structured list of issues/tasks for the Worker to address.
- Include optional clarifying questions (when no code change is needed yet).
- Include optional notes on _how_ something should be done (preferred approach, constraints).
- Remember all feedback given in previous rounds to avoid contradicting itself or looping on the same point.
- After approval: check whether the process is novel and worth capturing as a skill.
- After documentation: instruct the Coder sidecar to open a PR (or push to a target branch).

**Must NOT see:** The Worker's internal Thinker ↔ Coder conversation.

### Worker = Thinker (smart model) + Coder sidecar (fast model)

From the Reviewer's perspective, the Worker is a single black box. Internally it is split:

#### Thinker (smart model)

Interprets the Reviewer's issue list, plans the implementation, and delegates all codebase interaction to the Coder via the `readCodebase` and `editCodebase` tools. The Thinker cannot search, read, or write files itself—it physically only has those two tools in its tool array.

#### Coder sidecar (fast model / Cursor CLI)

Executes all file reads, writes, searches, and CLI commands inside a **git worktree** (so changes are isolated from the main working tree).

Instead of building custom tools (fs/bash), we use the **Cursor CLI (`cursor-agent`)** natively (or a **NativeCodebaseBackend** with Mastra + fs/shell tools when `CREW_MODEL_CODER` is not set to Cursor). The `editCodebase` tool spins up the CLI or backend with `cwd` set to the worktree path. The CLI/backend runs autonomously until the task is complete, running our `npm run check:agent` Validation Engine internally, and reports a concise summary back to the Thinker.

**Cursor CLI streaming — `stream-json` mode**: When using the Cursor CLI, `src/llm-providers/cursor/cursor-provider.ts` spawns `cursor-agent` with `--output-format stream-json --stream-partial-output`. Instead of waiting for the subprocess to exit, it parses each NDJSON line as it arrives. The event types are:

| Event type  | Subtype             | Meaning                                                                      |
| ----------- | ------------------- | ---------------------------------------------------------------------------- |
| `assistant` | —                   | Text delta from the model (forwarded to `onChunk`)                           |
| `tool_call` | `started`           | A tool invocation has begun (forwarded to `onCursorEvent`)                   |
| `tool_call` | `completed`         | A tool invocation has finished, with `result` (forwarded to `onCursorEvent`) |
| `result`    | `success` / `error` | Final summary text — this becomes the tool's return value                    |

**Native Coder streaming**: When using the `NativeCodebaseBackend`, standard Mastra streaming is used, and the text deltas and tool calls are forwarded to the same `onChunk`, `onCursorEvent`, and `onEvent` callbacks as the Cursor CLI, ensuring a unified UI regardless of the underlying execution engine.

The `onChunk` callback receives assistant text only. The `onCursorEvent` callback receives all typed events. `worker.ts` renders each `tool_call started` event as `↳ [cursor] <tool> <arg>` and each `completed` failure as `✗ [cursor] <tool> failed`. The cursor-agent's internal tool set includes: `editToolCall`, `writeToolCall`, `readToolCall`, `shellToolCall`, `grepToolCall`, `globToolCall`, `lsToolCall`, `deleteToolCall`, `readLintsToolCall`.

**Mastra fullStream — Thinker LLM visibility**: Both `runReviewerRound` and `runWorkerRound` use `agent.stream()` and drain `MastraModelOutput.fullStream` (not just `textStream`). `fullStream` carries every event type: `text-delta`, `reasoning-delta`, `tool-call` (when the Thinker calls `readCodebase` or `editCodebase`), `tool-result`, and `finish`. Each chunk has the shape `{ type, payload }` where `payload` is type-specific. `text-delta` and `reasoning-delta` payloads contain `{ text }` and are forwarded to `onThought`; every event is forwarded to `onEvent`. The `tool-call` payload contains `{ toolName, toolCallId, args }` — `worker.ts` inspects `args.query`/`args.context` for `readCodebase` and `args.directive`/`args.context` for `editCodebase` to print a preview immediately below the `⚙ tool:` line. The `tool-result` payload contains `{ toolName, isError }` and renders the `✓ done:` / `✗` closing bracket.

> **Critical**: `fullStream` MUST be drained concurrently with `output.object` using `Promise.all`. The underlying `ReadableStream` applies backpressure — if nothing reads it, the agent stalls and `output.object` never resolves, which also prevents `onChunk`/`onCursorEvent` from ever firing (the tool call itself is blocked behind the un-drained stream).

**Worker responsibilities (as a whole):**

- Implement the Reviewer's issue list.
- Report back to the Reviewer what was done: specific code changes, CLI calls, decisions made, and why.
- Maintain a cumulative log of all previous Reviewer feedback and what was done in response, to avoid re-implementing something undesirable.

**Must NOT see:** The Reviewer's internal reasoning (only the structured issue list contract is passed).

---

## Information Flow

### Internal Worker structure (hidden from Reviewer)

```
                    ┌─────────────────────────────────────────┐
                    │             ITERATION LOOP               │
                    │                                          │
                    │  Round 0 (skipInitialReview=true):       │
  Original Goal ───►│  WORK_STARTED synthesized ──────────────┼──►┐
                    │                                          │   │
                    │  Round 1+:                               │   │
                    │  [1] npm run check:agent (programmatic)   │   │
                    │      ↓ FAILED → bypass Reviewer,         │   │
                    │        synthesize NEEDS_WORK issue list  │   │
                    │      ↓ PASSED → continue to Reviewer     │   │
                    │  ┌─────────────┐     ┌───────────────┐  │   │
                    │  │  Reviewer   │────►│    Worker     │◄─┼───┘
                    │  │  (smart)    │◄────│  (black box)  │  │
                    │  └─────────────┘     └───────────────┘  │
                    │         │                    │           │
                    │  issue list + notes   work report +      │
                    │                       code changes       │
                    │                                          │
                    └────────────── up to maxRounds ───────────┘
                             │ APPROVED
                             ▼
                    ┌──────────────────┐
                    │  Hand off to     │
                    │  Human (merge    │
                    │  local branch)   │
                    └──────────────────┘
```

```
  Thinker (smart)
       │
       │  editCodebase("fix auth middleware, run check:agent until PASSED")
       ▼
  ┌──────────────────────────────────────────────────┐
  │  Coder sidecar (Cursor CLI) — git worktree       │
  │  runs native agent tools, auto-loops on failures │
  │  returns: concise summary of files changed       │
  └──────────────────────────────────────────────────┘
```

---

## Contracts (Zod schemas)

### Reviewer → Worker: `ReviewerIssueList`

### Worker → Reviewer: `WorkerReport`

```typescript
const ReviewerIssueListSchema = z.object({
  status: z.enum(['NEEDS_WORK', 'APPROVED', 'WORK_STARTED']),
  issues: z.array(
    z.object({
      id: z.string(), // stable across rounds, e.g. "I-001"
      description: z.string(), // what is wrong / what to fix
      notes: z.string().optional(), // how it should be done (approach, constraints)
    }),
  ),
  questions: z.array(z.string()), // clarification needed before coding
  contextNotes: z.string().optional(), // high-level framing or constraints
});
```

| Status         | Meaning                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEEDS_WORK`   | Reviewer found issues; Worker should address them. May also come from a **synthetic** bypass when `check:agent` fails (issue id `validation-failed`) — see "Deterministic validation" below.           |
| `APPROVED`     | Reviewer is satisfied; loop exits.                                                                                                                                                                     |
| `WORK_STARTED` | Synthetic — injected by the loop on round 0 when `skipInitialReview: true`. The goal is passed as a single issue so the Worker starts immediately, without a Reviewer evaluation on an empty worktree. |

`questions` is used when the Reviewer needs human clarification — in that case the loop pauses for human input before resuming. `WORK_STARTED` never has questions (it is synthesized, not produced by an LLM).

```typescript
const WorkerReportSchema = z.object({
  summary: z.string(), // high-level: what was done this round
  addressedIssues: z.array(
    z.object({
      issueId: z.string(),
      resolution: z.string(), // how it was resolved
    }),
  ),
  stepsLog: z.array(z.string()), // specific code changes, CLI calls, decisions
  codeChanges: z.string(), // see "Code Change Surface" below
  skippedIssues: z
    .array(
      z.object({
        issueId: z.string(),
        reason: z.string(),
      }),
    )
    .optional(),
});
```

### Isolation guarantee

The host loop only forwards the **structured contract objects** (`ReviewerIssueList`, `WorkerReport`) across the boundary. Neither side receives the other's raw Mastra `run()` logs or internal task thoughts.

---

## Code Change Surface

**Open question addressed here:** How should the Reviewer see what code the Worker changed?

**Decision: git worktree + Coder sidecar reads the diff**

The Worker's Coder operates inside a dedicated git worktree (`git worktree add .worktrees/crew-<jobId> -b crew/<jobId>`). All file changes happen inside that worktree. The Coder never touches the main working tree.

When the Worker submits its `WorkerReport`, the Coder runs `git diff main...HEAD` inside the worktree and appends a structured summary (changed files + patch) to `codeChanges`. The Thinker includes this verbatim in the report—it never reads raw diffs itself.

The Reviewer receives `codeChanges` as part of the `WorkerReport`. To inspect specific files or patches in depth, the Reviewer delegates to its own Coder sidecar (the same fast model, same tool set, pointed at the worktree path). This way:

- The Thinker (expensive) never ingests raw file contents.
- The Reviewer (expensive) never ingests raw diffs directly—it asks its Coder sidecar to summarize the relevant parts.
- The worktree is the single source of truth for all changes; both sides can inspect it.

**Handoff to Human (Local Merge):**

The script automatically stages all changes in the worktree and commits them to the isolated branch (`crew/worker-<timestamp>`). The worktree directory is deleted to clean up the filesystem, but the branch is preserved. With `--merge`, the orchestrator auto-merges the branch into your current checkout (see CLI Usage). Otherwise, you merge manually: `git merge crew/worker-<timestamp>`.

## CLI Visual Identity

The terminal output uses a consistent color and style scheme so you can tell at a glance which layer of the system is speaking. This is implemented with `@clack/prompts` (interactive prompts), `chalk` (color), and `marked-terminal` (markdown rendering).

| Layer                     | Color               | Examples                                                                                                                     |
| ------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| System / orchestrator     | dim gray            | Worktree created, committing, cleanup                                                                                        |
| Reviewer results          | cyan                | Analyzing, issues found, questions                                                                                           |
| Reviewer thoughts         | cyan dim (inline)   | `│  [Reviewer thinking] …` live token stream                                                                                 |
| Worker results            | yellow              | Implementing, summary, files changed                                                                                         |
| Worker Thinker tool calls | yellow dim          | `⚙ tool: readCodebase` / `editCodebase  (id)` + query or directive/context preview / `✓ done: readCodebase` / `editCodebase` |
| Worker thoughts           | yellow dim (inline) | `│  [Worker thinking] …` live token stream                                                                                   |
| Cursor CLI tool calls     | yellow dim          | `↳ [cursor] edit  src/config.ts` (one line per tool use)                                                                     |
| Cursor CLI failures       | yellow dim warn     | `✗ [cursor] shell failed`                                                                                                    |
| Cursor CLI assistant text | yellow dim (inline) | live text deltas from cursor-agent's `assistant` events                                                                      |
| Success / APPROVED        | bold green          | Session complete, merge instructions                                                                                         |
| Error                     | red                 | Critical failures                                                                                                            |

Thoughts and tool-use events are shown by default. Pass `--no-thoughts` to suppress all inline streams and see only final results.

**Example terminal output (Worker phase):**

```
│  [Worker] Starting work on initial task...
│
◇    ⚙ tool: readCodebase  (tool_readCodebase_xxx)
│    │  query:    Where are the model types and crew config defined? I need to add 'genius' and 'coder' model types.
│
◇      ↳ [cursor] grep  .worktrees/demo-worker-xxx
◇      ↳ [cursor] glob
◇      ↳ [cursor] read  src/models.ts
Here's what's in the codebase: …
│
◇    ✓ done:  readCodebase
│
◇    ⚙ tool: editCodebase  (tool_editCodebase_xxx)
│    │  directive: Update `src/models.ts` to add 'genius' and 'coder' model types. …
│    │  context:   The issue asks to add 2 new model types to crew config.
│
◇      ↳ [cursor] read  src/models.ts
◇      ↳ [cursor] edit  src/models.ts
◇      ↳ [cursor] shell  cd .worktrees/demo-worker-xxx && pnpm run check:agent
▲      ✗ [cursor] shell failed
◇      ↳ [cursor] edit  src/models.ts
│
◇    ✓ done:  editCodebase
│  [Worker thinking] {"summary": "Implemented genius and coder…", …}
│
│    Summary: Implemented the 'genius' and 'coder' model types.
│
│  [Worker] Files changed: 2
```

The interactive prompt (next-task input, clarification answers) uses `@clack/prompts`'s structured UI components (spinners, notes, text inputs) rather than raw `readline`, providing cancel-signal handling and a consistent visual frame.

---

## CLI Usage (`worker`)

The Iteration Loop is wired up to a CLI command, `demo-worker`. It runs in **interactive mode by default**: after each task completes the loop pauses and asks you for the next task. Only when you explicitly quit does it clean up and hand the branch back to you.

```
-g, --goal           Initial task or issue to implement (required)
-m, --max-rounds     Max iteration rounds per task (default: Infinity in interactive, 3 with --no-interactive)
-n, --no-interactive Single-run mode: run once, commit, cleanup, exit
-k, --keep-worktree  Do not delete the git worktree after completion
-y, --yes            Skip waiting for human clarification questions
    --no-thoughts    Hide live model reasoning tokens (thoughts shown by default)
-M, --merge          Auto-merge the worktree branch back into the current branch on success
```

### Interactive mode (default)

```bash
# Start a session — type new tasks at the prompt, quit when done
npm run demo-worker -- --goal "Fix the math function in src/math.ts"
```

The prompt after each task:

```
Next task (or "quit"/"stop" to finish, Ctrl+D to exit):
>
```

Type any new task to continue in the same worktree/branch, or type `quit` / `stop` / press Ctrl+D or Ctrl+C to end the session.

**Stopping mid-run (Ctrl+C behaviour):**

| Press              | Effect                                                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ctrl+C once        | Sets `stopped` flag. Prints _"Press Ctrl+C again to force-stop immediately."_ The in-flight agent round runs to completion, progress is committed, then the session exits and the worktree is cleaned up.                     |
| Ctrl+C twice       | Aborts the in-flight LLM call via `AbortSignal`. Worktree is torn down without a final commit (partial changes remain on the branch). Prints _"Press Ctrl+C once more to exit immediately, skipping cleanup."_                |
| Ctrl+C three times | **Hard exit**: calls `process.exit(1)` immediately, bypassing all cleanup. Use as an escape hatch if teardown from the second press got stuck. The CLI prints the worktree path and branch name so you can clean up manually. |

### Single-run mode (`--no-interactive`)

```bash
# Run exactly once, then commit and clean up
npm run demo-worker -- --goal "Implement auth middleware" --no-interactive

# Limit rounds in single-run mode
npm run demo-worker -- --goal "Implement auth middleware" --no-interactive --max-rounds 5

# Preserve the worktree for debugging
npm run demo-worker -- --goal "Refactor tests" --no-interactive --keep-worktree

# Auto-merge the worktree branch into your current branch on success
npm run demo-worker -- --goal "Implement auth middleware" --no-interactive --merge
```

### What happens when you run it:

1. **Creation**: It creates a branch named `crew/worker-<timestamp>`. The code is isolated in a temporary worktree folder (`.worktrees/demo-worker-<timestamp>`).
2. **Iteration**: The Reviewer and Worker loop. `maxRounds` is `Infinity` in interactive mode (unbounded per task), or `3` by default in single-run mode. The Coder sidecar modifies files _only_ inside that `.worktrees/` folder.
3. **Commit**: After each task completes, all changes are staged and committed to the `crew/worker-<timestamp>` branch.
4. **Cleanup & Handoff**:
   - **Interactive mode**: The worktree stays alive between tasks. Only after you explicitly quit is the `.worktrees/` folder deleted. The branch is always preserved. With `--merge`, the orchestrator auto-merges into your current branch; otherwise it prints the manual `git merge` instruction.
   - **Single-run, APPROVED**: The `.worktrees/` folder is deleted, but the branch is preserved. With `--merge`, auto-merge into your current branch; otherwise output: `git merge crew/worker-<timestamp>`.
   - **Single-run, NEEDS_WORK**: Both the folder and the branch are deleted (unless you passed `--keep-worktree`). The unsuccessful attempt is discarded.

---

## Memory Design

Mastra does not persist state across `agent.generate()` calls by default. The host JavaScript loop owns all cross-round memory, passing it back into each fresh agent invocation via prompt injection.

### Reviewer memory (owned by host loop)

```typescript
interface ReviewerMemory {
  feedbackLog: Array<{
    round: number;
    issues: ReviewerIssueList['issues'];
    workerSummary: string; // what the Worker claimed to do
  }>;
}
```

Injected into every new Reviewer task as:

> "Previous rounds summary: [serialized feedbackLog]. Do NOT re-raise issues already marked resolved."

### Worker memory (owned by host loop)

```typescript
interface WorkerMemory {
  allReviewerIssues: Array<{
    round: number;
    issues: ReviewerIssueList['issues'];
  }>;
  allResolutions: Array<{
    round: number;
    report: WorkerReport;
  }>;
}
```

Injected into every new Thinker task so the Worker knows the full history of feedback and what was done, preventing it from re-implementing something previously rejected.

## Post-Approval: Skill Discovery

Unless `--no-discovery` is passed, after `status === "APPROVED"` the Reviewer runs a final assessment:

1. The orchestrator lists open issues with label `skill-candidate` via `gh issue list`, and passes them to the Reviewer.
2. The Reviewer asks its Coder sidecar to scan `/.cursor/skills/` and `/.cursor/rules/` for existing skills matching the work just done.
3. If a similar skill exists, no issue is created; the Reviewer notes this in the final result.
4. If no similar skill exists, the Reviewer checks whether any of the existing `skill-candidate` issues is relevant (same pattern, same intent). If so, no issue is created; the orchestrator prints the matching issue number/URL.
5. If no similar skill and no relevant existing issue: the Reviewer creates a GitHub issue via `gh issue create` with:
   - **What code was introduced** (file list from the worktree diff).
   - **Summarized Reviewer feedback** across all rounds (desired behavior, constraints, recurring notes).
   - **Summarized Worker steps log** (exact actions taken, CLI calls, decisions).
   - **Context**: the original goal and why this work was initiated.
   - **Label**: `skill-candidate`.
     The orchestrator prints the created issue URL/ID (from `gh` stdout) after success.

With `--no-discovery`, the skill discovery phase is skipped entirely (no `gh` calls).

---

## Post-Approval: Local Branch Handoff

### Interactive mode

The orchestrator commits progress after **every task**, keeping the worktree alive throughout the session:

1. **Per-task auto-commit**: After each task loop ends (`APPROVED` or `MAX_ROUNDS_REACHED`), all changes are staged and committed to `crew/worker-<timestamp>` with the message `worker: <goal>`.
2. **Session continues**: The worktree directory and branch are preserved. The next task picks up from the same worktree, accumulating commits on the same branch.
3. **On quit/stop/Ctrl+C/Ctrl+D**: The worktree directory is deleted from disk, but the branch is always preserved (regardless of final task status).
4. **Handoff**:
   - If `--merge` is passed, the orchestrator automatically runs `git merge crew/worker-<timestamp>` in your main working directory. If this fails (e.g. due to uncommitted changes in your main working tree or conflicts), it safely aborts the merge and tells you to merge manually.
   - Otherwise, you review and merge manually: `git merge crew/worker-<timestamp>`.

### Single-run mode (`--no-interactive`)

1. **Auto-commit**: Stages all changes and commits to `crew/worker-<timestamp>` with `worker: <goal>`.
2. **Branch Preservation**:
   - `APPROVED`: Worktree directory deleted, branch preserved.
   - `NEEDS_WORK` / `MAX_ROUNDS_REACHED`: Both worktree directory and branch deleted (unless `--keep-worktree` was passed).
3. **Handoff**: Auto-merged if `--merge` was passed, otherwise manually merged via `git merge crew/worker-<timestamp>`.

This design ensures the AI operates in a sandbox and never touches the main working directory or pushes to remote branches automatically. It hands a clean, local branch back to the human for final review.

---

## Architecture: Meta-Orchestration Layer

Mastra workflows are declarative and finite. The iteration loop lives in the host TypeScript script, not inside a Mastra Workflow. Each round consists of separate agent invocations:

```typescript
while (round < maxRounds) {
  // 1. Reviewer reviews current state (or bypass if check:agent fails)
  // runReviewer callback: runs check:agent first; on FAILED, returns synthetic
  // NEEDS_WORK without calling runReviewerRound; on PASSED, calls runReviewerRound.
  const issueList = await runReviewer(worktreePath, workerMemory, reviewerMemory);
  reviewerMemory.feedbackLog.push({ round, issues: issueList.issues, workerSummary: '' });

  if (issueList.status === 'APPROVED') break;
  if (issueList.questions.length > 0) {
    /* pause for human input */
  }

  // 2. Worker implements changes in worktree
  const report = await runWorker(issueList, worktreePath, workerMemory);
  reviewerMemory.feedbackLog[round]!.workerSummary = report.summary;
  workerMemory.allReviewerIssues.push({ round, issues: issueList.issues });
  workerMemory.allResolutions.push({ round, report });

  round++;
}

// 3. Post-approval: skill discovery + PR
await runPostApproval(worktreePath, reviewerMemory, workerMemory, options);
```

---

## Files to Create / Modify

| File                                 | Change                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `src/crews/utils/iteration-loop.ts`  | New — generic `runIterationLoop()` with memory injection                                 |
| `src/utils/git-worktree.ts`          | New — git worktree lifecycle (create, diff, cleanup)                                     |
| `src/crews/utils/run-check-agent.ts` | New — `runCheckAgent()`, `runCheckAndDecide()`, `synthesizeIssueListFromCheckFailure()`  |
| `src/crews/reviewer.ts`              | New — Reviewer agent + task factory + post-approval logic                                |
| `src/crews/worker.ts`                | New — Thinker agent with `askCoder` DynamicTool wrapping a fast-model Coder sidecar      |
| `src/crews/prd-review.ts`            | Modified — wire into iteration loop; Worker becomes Thinker+Coder                        |
| `src/models.ts`                      | Minor — add `coderLcoderModelrt (fast model, no change needed if fastLlm is already set) |

No new npm dependencies expected (`simple-git` may be added if `git` CLI calls via `runCli` are insufficient for worktree management).

---

## Testability

- `runIterationLoop` accepts injected `runReviewer` / `runWorker` callbacks → fully unit-testable with mocks.
- `git-worktree.ts` is a thin wrapper over `git`; test with a real temp repo or mock `runCli`.
- `reviewer.ts` and `worker.ts` are tested via integration test using `--demo` flag with `maxRounds=1`.
- Skill-discovery path is tested by pointing the Coder sidecar at a mock skills directory.

---

## Edge Cases and Risks

| Risk                                                   | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Validation fails but Reviewer doesn't surface it       | Orchestrator runs `check:agent` programmatically before each Reviewer round. On FAILED, bypass Reviewer and synthesize NEEDS_WORK with `validation-failed` issue; Worker gets failure details immediately. No LLM call. See `src/crews/utils/run-check-agent.ts`.                                                                                                                                                                    |
| Reviewer loops on same issue                           | `reviewerMemory.feedbackLog` injected with "do NOT re-raise resolved issues" instruction                                                                                                                                                                                                                                                                                                                                             |
| Worker re-implements something previously rejected     | `workerMemory.allResolutions` injected into every Thinker prompt                                                                                                                                                                                                                                                                                                                                                                     |
| Thinker calls file tools directly                      | Tool array only contains `readCodebase` and `editCodebase`; framework rejects any other tool call                                                                                                                                                                                                                                                                                                                                    |
| Worktree diverges from main                            | Worktree created fresh from current HEAD; user resolves conflicts when merging back (with `--merge` or manually)                                                                                                                                                                                                                                                                                                                     |
| Coder makes changes outside worktree                   | Coder's working directory is the worktree path; host enforces this via `cwd` in `spawn`                                                                                                                                                                                                                                                                                                                                              |
| Coder modifies validation scripts to fake a pass       | Host-level Reviewer inspects the worktree diff. Host memory is immutable from the sidecar. Even if the sidecar alters the Reviewer's own TS file in the worktree, the orchestrator is already running in the host process using the original, un-tampered `reviewer.ts`. The orchestrator also runs `check:agent` programmatically before each Reviewer round—validation failures bypass the Reviewer and go straight to the Worker. |
| Reviewer sees Thinker thoughts                         | Only `WorkerReport` schema object crosses the boundary, never `workflowLogs`                                                                                                                                                                                                                                                                                                                                                         |
| Cost blowup                                            | Interactive mode: `maxRounds=Infinity` per task but the human controls session length. Single-run: `maxRounds=3` default. `--max-rounds N` overrides both. Best-round fallback on exhaustion.                                                                                                                                                                                                                                        |
| Skill-discovery false positive (existing skill missed) | Coder scans both `/.cursor/skills/` and `/.cursor/rules/`; Reviewer makes final judgment call                                                                                                                                                                                                                                                                                                                                        |
| User presses Ctrl+C once (mid-agent-run)               | Sets `stopped` flag. Prints `"Press Ctrl+C again to force-stop immediately."` The current LLM call continues to completion, progress is committed, then the session exits gracefully. No partial changes are lost.                                                                                                                                                                                                                   |
| User presses Ctrl+C twice (force-stop)                 | First press sets `stopped` and shows the hint. Second press fires an `AbortController` signal that is passed into `runReviewerRound` / `runWorkerRound` → `agent.stream({ abortSignal })`. The in-flight LLM call is cancelled immediately. The worktree is torn down without a commit (partial changes remain on the branch). Prints hint: `"Press Ctrl+C once more to exit immediately, skipping cleanup."`                        |
| User presses Ctrl+C three times (hard exit)            | Calls `process.exit(1)` immediately, bypassing the `finally` block entirely. Use as an escape hatch if the worktree teardown from the second press got stuck. The worktree directory and branch are left intact for manual cleanup — the CLI prints the worktree path and branch name before exiting.                                                                                                                                |
| User quits before any task completes                   | Impossible — quit is only offered at the between-task prompt, not during agent execution.                                                                                                                                                                                                                                                                                                                                            |
| `--merge` fails (uncommitted changes, conflicts)       | Orchestrator runs `git merge` in the main workdir; on failure it aborts, leaves branch intact, and prints the manual `git merge` instruction.                                                                                                                                                                                                                                                                                        |

---

## Testing Strategy & Guarantees

The implementation of the Iteration Loop was developed using a Test-Driven Development (TDD) approach with progressive phases of confidence:

- **Phase 1: Sandbox (Worktree)** - Guarantees changes are isolated and cleanup works.
- **Phase 2: Orchestrator Loop** - Guarantees the state machine advances, memory is correctly injected, and it exits on `APPROVED`. Includes unit tests for the `runReviewer` callback: when `check:agent` passes, `runReviewerRound` is called; when it fails, Reviewer is bypassed and a synthetic `NEEDS_WORK` issue list is returned.
- **Phase 3: Tool Boundary (`readCodebase` / `editCodebase`)** - Guarantees isolation (`cwd` is the worktree), graceful fallback on CLI errors, automatic injection of the validation engine mandate (`npm run check:agent`), live streaming of Cursor CLI assistant text via `onChunk`, live streaming of Cursor CLI tool-call events via `onCursorEvent` (enables `↳ [cursor] edit …` lines in the terminal), live streaming of Reviewer/Worker LLM reasoning and tool events via `onThought`/`onEvent` from `fullStream` (all controlled by the `--no-thoughts` flag, default: on).
- **Phase 4: Live Fire Eval** - An integration test (`iteration-e2e.test.ts`) that runs real LLMs (via Cursor CLI) to prove the loop can autonomously fix a failing test without human intervention.
- **Phase 5: Agent Contracts** - Unit tests for `reviewer.ts` and `worker.ts` that mock the LLM to prove prompt construction and Zod schema parsing work correctly.

### Tamper-Proof Constraint Guarantee (Sidecar Subversion)

A critical security risk in autonomous AI factories is the "Sidecar Subversion" attack vector: the Coder sidecar could theoretically modify the validation scripts themselves (e.g., `src/engine/validate/prevent-spec-modifications.ts` or `scripts/engine/index.ts`) to fake a `PASSED` status, rather than doing the hard work of fixing the code.

We guarantee this is impossible through two architectural boundaries:

1. **Host-Level Immutable Reviewer**: The Worker/Reviewer orchestration loop runs in the _host_ process. The sidecar only runs in an isolated sub-process. Because the host's memory and execution context are immutable from the perspective of the worktree, the Reviewer (which runs in the host process) acts as the ultimate un-hackable authority. Even if the sidecar changes the `reviewer.ts` file or the validation scripts in the worktree, the orchestrator is already running using the original, un-tampered host files. The Reviewer will inspect the `git diff` of the worktree against the original base branch, see that the sidecar modified protected files, flag it as a violation of constraints, and reject the work (`NEEDS_WORK`).
2. **Engine-Level Hard Stops**: The Validation Engine itself includes custom scripts (e.g. `prevent-spec-modifications.ts`) that instantly crash the build if the sidecar's `git status` shows uncommitted changes to protected directories like `specs/`.

---

## Estimated Scope

**Large** — 5 new/modified files, ~450 lines of new TypeScript.

| File                      | Est. lines |
| ------------------------- | ---------- |
| `utils/iteration-loop.ts` | ~80        |
| `utils/git-worktree.ts`   | ~60        |
| `reviewer.ts`             | ~120       |
| `worker.ts`               | ~120       |
| `prd-review.ts` changes   | ~70        |

---

## Decisions

1. **Best-round fallback:** When `maxRounds` is exhausted in single-run mode, the last round's state is always committed and handed back. Issue count is not a reliable proxy for severity (2 major issues beats 3 minor lint errors), so "fewest issues" would be non-obvious. Last round is the only unambiguous choice.

# TDD and the Validation Engine

This document describes the TDD (Test-Driven Development) / Software Factory approach adopted in this repo, and the deterministic **Validation Engine** that enables AI-driven iteration without human code review.

---

## 1. Overview

### Why a Deterministic Validation Engine?

If the AI cannot test its work against a ground truth, it is an **assistant**, not a **factory**.

We use a deterministic Validation Engine instead of LLM-based code review for a simple reason: **Validation replaces Code Review**. LLM reviewers can hallucinate approval—they are non-deterministic and can agree with flawed code. A deterministic engine (TypeScript compiler, linter, formatter, tests, custom constraints) produces an objective pass/fail signal. The AI loops against this signal until it converges.

The core principle from the [Software Factory](https://www.strongdm.com/blog/the-strongdm-software-factory-building-software-with-ai) concept:

> In an AI Software Factory, humans do not write code, nor do they review the AI's code. **Humans write the Constraints and Scenarios.**

The Validation Engine embodies those constraints. The AI's job is to satisfy them.

---

## 2. The Validation Engine

The engine is implemented in `src/engine/index.ts` and invoked via two npm scripts:

- **`npm run check`** — Human mode: streams output to the terminal
- **`npm run check:agent`** — Agent mode: emits structured JSON for the AI to parse

### Phases

The engine runs five phases in order, stopping at the first failure:

| Phase                 | Command                | Purpose                             |
| --------------------- | ---------------------- | ----------------------------------- |
| 1. Types              | `npx tsc --noEmit`     | TypeScript type checking            |
| 2. Lint               | `npm run lint`         | ESLint                              |
| 3. Format             | `npm run format:check` | Prettier check                      |
| 4. Unit Tests         | `npm run test`         | Vitest                              |
| 5. Custom Constraints | `npm run validate`     | Project-specific validation scripts |

### Sequential Execution

Phases run one after another. If any phase fails, the engine exits with code 1 and does not run subsequent phases. This keeps feedback focused: fix the current failure first.

### Human Mode vs Agent Mode

**Human mode** (`npm run check`):

- Each phase streams its output to stdout/stderr
- On failure: prints a clear error message and exits
- No structured output

**Agent mode** (`npm run check:agent`):

- Uses `--reporter=agent` flag
- stdout/stderr are captured; nothing streams to the terminal
- Output is a single JSON object on the last line:
  - **On success:**

    ```json
    { "status": "PASSED" }
    ```

  - **On failure:**
    ```json
    {
      "status": "FAILED",
      "phase": "Phase 3: Format",
      "command": "npm run format:check",
      "details": "..."
    }
    ```

The `details` field contains the last 50 lines of the failing command's output—enough for the agent to understand and fix the issue.

### Reference

- Implementation: `src/engine/index.ts`
- Custom validation scripts: `src/engine/validate/index.ts` (discovers and runs all `.ts` files except `index.ts` in that directory)

---

## 3. TDD Scaffolding for the Iteration Loop

The Worker node in the Reviewer–Worker iteration loop is built incrementally. We use TDD-style scaffolding: each phase is testable in isolation before integrating live AI.

### Phase 1: Worktree Manager (`src/utils/git-worktree.ts`)

The Worktree Manager provides an **isolated sandbox** for agent changes:

- `createWorktree(jobId, baseBranch?)` — Creates a git worktree at `.worktrees/crew-<jobId>` on branch `crew/<jobId>`
- `getDiff(worktreePath, baseBranch)` — Returns the diff of the worktree against the base branch
- `cleanupWorktree(jobId)` — Removes the worktree and deletes the branch

All Agent modifications happen inside the worktree. The main working tree stays untouched.

### Phase 2: Meta-Orchestrator Loop (`src/crews/utils/iteration-loop.ts`)

The iteration loop is a **host-side orchestration layer** that runs outside the AI framework:

- Accepts injected `runReviewer` and `runWorker` callbacks → fully unit-testable with mocks
- Maintains `ReviewerMemory` and `WorkerMemory`, injecting them into each round
- Breaks on `APPROVED` or when `maxRounds` is reached
- No LLM calls in the loop itself—callbacks can be mocks

Tests (e.g. `src/crews/utils/iteration-loop.test.ts`) use mocked Reviewer and Worker to verify memory injection, round counting, and early exit on APPROVED.

### Phase 3 (Future): Coder Tools Bound to Worktree

The Coder sidecar (Thinker’s tool) will execute file reads, writes, and CLI commands **inside the worktree**. The Validation Engine (`npm run check:agent`) will be invoked from that worktree path. Not yet implemented.

### Phase 4 (Future): Live Fire Eval with Real LLMs

Once Coder tools are bound to the worktree, the Reviewer and Worker will use real LLMs. The Worker will run `npm run check:agent` after each change and iterate until `status === "PASSED"`.

---

## 4. The Bootstrapping Problem

You cannot have the engine before you know what to test.

The sequence:

1. **Human explores** — Build the first scraper, feature, or module manually
2. **Human extracts** — Identify what you manually checked (types, lint, tests, edge cases)
3. **Engine captures** — Codify those checks into phases (tsc, lint, format, tests, `src/engine/validate/*.ts`)
4. **AI iterates** — Worker runs the engine, fixes failures, repeats

After the first scraper (or feature), pause and codify what you manually verified into engine phases. The engine accumulates with each iteration. New domains start with a sparse engine; mature domains have dense, deterministic coverage.

See `specs/draft-spec-first-prd-diff/software_factory.md` for a deeper discussion of the bootstrapping problem and how it relates to the StrongDM Software Factory.

---

## 5. Single Command, Zero Decisions

The agent **never** decides what to run. It runs `npm run check:agent` and reads the output.

- If `status === "PASSED"` → done
- If `status === "FAILED"` → fix the issue indicated by `phase`, `command`, and `details`; run again

There is no prompting for "run lint" vs "run test" vs "run format." The engine decides the order and scope. The agent has one job: make the single command pass.

---

## 6. Structured Error Output

The `details` field gives the agent targeted feedback: the last 50 lines of the failing command's output. For lint errors, that includes file paths and line numbers. For test failures, that includes the assertion message and stack trace.

An optional `hint` field (not yet in our engine) could encode institutional knowledge for common failure modes—e.g., "If this lint error appears, check that the new export is listed in `package.json` exports." That would further accelerate agent self-correction.

---

## 7. Relation to Spec-First Pipeline

The Validation Engine and the Spec-First PRD diff serve different roles in the pipeline:

| Component           | Feeds     | Role                                                        |
| ------------------- | --------- | ----------------------------------------------------------- |
| Spec-First PRD Diff | Architect | `TextualChangeReport` → `SemanticChangeReport` → design doc |
| Validation Engine   | Worker    | Ground truth for code quality—loop until pass               |

Flow:

```
PRD → Textual Diff → Semantic Diff → Architect → Worker (loops against Engine) → PR
```

The spec-first pipeline provides **semantic scope** (what changed, what to build). The Validation Engine provides **executable ground truth** (whether the code is correct). Together they form the full funnel: Human Intent → Structured Architecture → Closed-loop Code Generation.

---

## 8. Project Structure for TDD

To manage TDD effectively in an AI-driven codebase, we enforce a strict separation between **Human-authored Constraints** and **AI-generated Code/Tests**.

We use the `specs/` directory as the source of truth for all design decisions and authoritative TDD tests.

### The `specs/` Directory Pattern

For each major feature, architectural component, or workflow, create a dedicated directory under `specs/`. Features can be nested to any level (e.g., `specs/core/auth/oauth/`). Directories prefixed with an underscore (`_`) are explicitly ignored by the tooling, serving as an escape hatch for drafts, notes, or scaffolding.

```
specs/
  ├── _drafts/               # Ignored escape hatch
  ├── core/
  │    ├── auth/
  │    │    ├── README.md         # The design doc / spec
  │    │    └── auth.test.ts      # Authoritative human-authored TDD tests
  ├── feature-name/
  │    ├── README.md         # The design doc / spec
  │    ├── feature.test.ts   # Authoritative human-authored TDD tests
  │    └── ...
```

**Key Principles:**

1. **Specs as Data**: The `README.md` in each `specs/` folder acts as the textual specification and context for the AI Worker.
2. **Authoritative Tests**: The tests within the `specs/` folder are the **ground truth** (the "Constraints" in the Software Factory model). They define the deterministic success criteria. Humans write these.
3. **AI-Generated Code**: The AI Worker implements the actual code in `src/` or `scripts/` to make the `specs/` tests pass.
4. **AI-Generated Tests**: If the AI needs to write granular unit tests to cover its own implementation details, those tests live next to the code (e.g., `src/feature.test.ts`). This cleanly separates the high-level, human-authored acceptance tests (in `specs/`) from the low-level, AI-authored unit tests (in `src/`).

This structure guarantees that the AI cannot accidentally rewrite the success criteria (the authoritative tests) to artificially pass the Validation Engine, because the agent's work scope is constrained to the implementation, not the specification.

---

## 9. References

- **Iteration Loop design:** [specs/agents/worker/README.md](../specs/agents/worker/README.md)
- **Spec-First PRD Diff:** [specs/draft-spec-first-prd-diff/README.md](../specs/draft-spec-first-prd-diff/README.md)
- **Software Factory concepts:** [specs/draft-spec-first-prd-diff/software_factory.md](../specs/draft-spec-first-prd-diff/software_factory.md)
- **StrongDM Software Factory:** [strongdm.com/blog/the-strongdm-software-factory-building-software-with-ai](https://www.strongdm.com/blog/the-strongdm-software-factory-building-software-with-ai)

# Spec-First PRD Pipeline: Textual and Semantic Change Detection — Design

## Goal

Design the implementation of **Step 1** (PRD structure and creation), **Step 2** (detect textual changes), and **Step 3** (derive semantic changes) from [issue #16](https://github.com/JuroOravec/agents/issues/16). These steps feed the spec-first development pipeline: PRD → textual diff → semantic diff → architect → PM & workers → PRs → review → merge → release.

**Scope:** Steps 1–3. Step 4 (architect handoff) and later are out of scope for this design.

---

## Context: Spec-first pipeline

| Step  | Purpose                                                                    |
| ----- | -------------------------------------------------------------------------- |
| **1** | **PRD structure and creation** — how to create and organise PRDs           |
| **2** | **Detect textual changes in PRD** — git as source of truth                 |
| **3** | **Derive semantic changes** (e.g. "previously Redis for caching; now Xyz") |
| 4+    | Architect, PM, workers, PRs, review, merge, release                        |

---

## Step 1: PRD structure and creation

### Folder layout

Use a top-level `prds/` directory, with structure similar to skills:

```
prds/
├── my-feature/           ← feature dir; may nest further
│   ├── PRD.md            ← workhorse: specs for this feature
│   └── ...               ← optional supplementary files
├── another-feature/
│   └── PRD.md
└── nested/
    └── sub-feature/
        └── PRD.md
```

- **`prds/`** — root for all PRDs.
- **Nesting** — arbitrary depth until the leaf dir. Each leaf (feature) dir **must** contain `PRD.md`.
- **`PRD.md`** — the main spec document for that feature; this is what the pipeline consumes.
- **Supplementary files** — the feature dir may contain other files (diagrams, mockups, references). These are not processed by the textual/semantic diff; they are available as context or assets.

### Creating a new PRD

1. Create a feature dir under `prds/` (e.g. `prds/my-feature/`).
2. Add `PRD.md` with the product requirements for that feature.
3. Optionally add supporting files in the same dir.
4. Commit. A **new PRD** = file not in git history; an **update** = changes detectable via git diff.

### Relation to skills

The layout mirrors `.cursor/skills/` (top-level container, nested dirs, leaf contains the main document). This keeps PRDs discoverable and organised by feature.

---

## Step 2: Detect textual changes in PRD

### Principle: Git as source of truth

**Textual changes** are whatever git sees as changed. The detection logic supports two scenarios:

| Scenario                | What we compare                | Use case                                                                     |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| **Committed changes**   | Last commit vs previous commit | CI, PR review, post-commit pipeline                                          |
| **Local (uncommitted)** | Working tree vs HEAD           | Developer working locally; detect changes before commit (once saved to disk) |

In both cases, **git diff** is the source of truth. No separate "baseline file" or manual comparison—git tracks what changed.

### Assumptions

1. **PRD paths** follow Step 1 layout: `prds/<feature>/PRD.md` (and nested variants).
2. **Git** — PRDs are under version control. We operate in a git repo.

### Data to collect

| Item             | Source                                      | Format                     |
| ---------------- | ------------------------------------------- | -------------------------- |
| PRD path(s)      | Discovery under `prds/` or explicit `--prd` | `string` or `string[]`     |
| Current content  | Filesystem (working tree)                   | `string`                   |
| Baseline content | Git (from chosen ref)                       | `string` or `null`         |
| Unified diff     | `git diff`                                  | `string` (git diff format) |

### Detection logic

1. **Resolve PRD path(s)**
   - Either: discover all `prds/**/PRD.md` under the repo, or accept `--prd <path>` for a specific file.

2. **Choose diff mode**
   - **Committed:** `git diff HEAD~1 HEAD -- <prd_path>` — changes introduced in the last commit.
   - **Local (uncommitted):** `git diff HEAD -- <prd_path>` — working tree vs HEAD (includes both staged and unstaged). This captures everything not yet committed. _Note:_ Editor unsaved changes must be written to disk first; git only sees file contents on disk.

3. **New PRD**
   - If the file is **new** (untracked or not in `HEAD`): treat as 100% additions; diff vs empty or use full content as "added."

4. **Output**
   - Unified diff (git format) plus `current_content` and `baseline_content` for downstream semantic extraction.

### Output format (Step 2)

```typescript
interface TextualChangeReport {
  prd_path: string;
  diff_mode: 'committed' | 'local'; // committed = HEAD~1..HEAD; local = HEAD..working
  baseline_ref: string | null; // e.g. "HEAD", "HEAD~1", or null if new
  is_new_prd: boolean;
  diff: string; // unified diff (git format)
  current_content: string; // full current PRD text (from working tree)
  baseline_content: string | null;
}
```

### Implementation options

| Option                                             | Pros                                    | Cons                                  |
| -------------------------------------------------- | --------------------------------------- | ------------------------------------- |
| **A. CLI script** (`scripts/prd-diff.sh` or `.ts`) | Runs in CI, local dev; no agent runtime | Requires git, filesystem              |
| **B. Agent-invoked tool**                          | Fits into existing agent flow           | Depends on agent context and tool use |
| **C. GitHub Action / webhook**                     | Triggers on PR with PRD changes         | Couples to GitHub; more infra         |

**Recommendation:** **Option A (CLI script)** as the primary mechanism. The script:

- Accepts `--prd <path>` (or discovers `prds/**/PRD.md`), `--mode committed|local` (default: local for interactive use)
- Outputs JSON (`TextualChangeReport`) to stdout or a file
- Can be invoked by an agent, CI, or a GitHub Action

### Edge cases

| Case                       | Handling                                                                        |
| -------------------------- | ------------------------------------------------------------------------------- |
| PRD path missing           | Error: "PRD file not found"                                                     |
| PRD unchanged (diff empty) | `diff: ""`, `is_new_prd: false` — Step 3 can short-circuit: no semantic changes |
| Multiple PRD files         | Iterate; produce one report per file or one combined diff                       |
| Binary or non-UTF-8        | Reject or warn; PRD should be text                                              |

---

## Step 3: Derive semantic changes

### Input

- `TextualChangeReport` from Step 2 (or its fields: `diff`, `current_content`, `baseline_content`, `is_new_prd`).

### Output

Structured list of **semantic changes**: high-level, product-meaningful descriptions of what changed, not raw line edits.

**Example (from issue #16):**

> If we change a single word "Redis" to "Xyz" but the entire sentence now says "we use Xyz for caching", one derived semantic change is:
> **"Previously we used Redis for caching; now we want to use Xyz."**

### Data model

```typescript
interface SemanticChange {
  id: string; // e.g. UUID or slug for reference
  type: 'addition' | 'modification' | 'removal';
  summary: string; // One-line human-readable summary
  before?: string; // Previous state (for modification/removal)
  after?: string; // New state (for addition/modification)
  rationale?: string; // Optional: why this matters for implementation
  affected_sections?: string[]; // e.g. ["Caching", "Infrastructure"]
}

interface SemanticChangeReport {
  prd_path: string;
  is_new_prd: boolean;
  changes: SemanticChange[];
  raw_diff_ref?: string; // Optional: pointer to diff for traceability
}
```

### Approach: LLM-based semantic extraction

**Multiple models / roles:** We want multiple models or roles to interact and review the PRD changes—e.g. one for initial semantic extraction, another for critique or validation, a third for consolidation. The exact orchestration (sequential review, debate, consensus) is to be designed. <!-- TODO: specify which models per role (primary extractor, reviewer, etc.) and how they interact -->

**Rationale:** Semantic diff is not reducible to line-based diff. Research (document revision analysis, SwissGov-RSD benchmark) shows that:

- Diff-based representation + two-stage decomposition (edit descriptions → summarization) works well.
- LLMs can produce thematic, summarised change descriptions when given structured prompts.
- Use a **smart, low-hallucination model** (e.g. Gemini 2.0 Pro, Claude, or GPT-4) per the issue's model assignments.

**Prompt strategy:**

1. **Provide both diff and full context.**
   - Pass the unified diff.
   - Optionally pass `baseline_content` and `current_content` (or excerpts) so the model has full context for ambiguous edits.

2. **Structured output.**
   - Request JSON conforming to `SemanticChangeReport`.
   - Use JSON schema in the prompt or response format (e.g. structured outputs / tool use) to reduce hallucination and parsing errors.

3. **Instructions.**
   - "Derive semantic changes: high-level, product-meaningful descriptions. Ignore purely cosmetic edits (typos, formatting). Group related edits into a single semantic change when appropriate."
   - "For each change, indicate: addition, modification, or removal. Provide before/after where relevant."

### Two-stage decomposition (optional refinement)

For long PRDs or many edits:

1. **Stage 1:** Generate **per-edit descriptions** for each diff hunk (or chunk of edits).
2. **Stage 2:** **Cluster and summarise** — group related edits, produce one `SemanticChange` per cluster.

This reduces context load and can improve consistency. For an initial implementation, a single-pass prompt may suffice; add two-stage if outputs are noisy or incomplete.

### Implementation options

| Option                      | Pros                                                     | Cons                                                   |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| **A. CLI script + LLM API** | Reusable, testable, CI-friendly                          | Requires API key, network                              |
| **B. Agent-invoked**        | Uses existing Composer/agent runtime                     | Tied to agent context; harder to run headless          |
| **C. Hybrid**               | CLI calls out to a small Node/TS script that invokes LLM | Clear separation; script can be unit-tested with mocks |

**Recommendation:** **Option C (Hybrid)**. A script `scripts/prd-semantic-diff.ts` (or similar):

- Reads `TextualChangeReport` from stdin or file.
- If `is_new_prd` and no meaningful diff: return "all new" or list high-level sections as additions.
- Else: Build prompt with diff + optional context, call LLM, parse JSON, validate against schema.
- Output `SemanticChangeReport` to stdout.

The CLI from Step 2 can optionally chain: `prd-diff | prd-semantic-diff`.

### Example prompt (for implementers)

```
You are analyzing changes in a Product Requirements Document (PRD).

Input:
- unified_diff: <the git diff output>
- is_new_prd: false
- baseline_content (excerpt): ...
- current_content (excerpt): ...

Task: Derive semantic changes — high-level, product-meaningful descriptions.
Ignore cosmetic edits (typos, formatting). Group related edits into one semantic change.

Output JSON matching this schema:
{
  "prd_path": "string",
  "is_new_prd": false,
  "changes": [
    {
      "id": "uuid or slug",
      "type": "addition" | "modification" | "removal",
      "summary": "One-line human-readable summary",
      "before": "Previous state (for modification/removal)",
      "after": "New state (for addition/modification)",
      "rationale": "Optional: why this matters",
      "affected_sections": ["Section names"]
    }
  ]
}
```

### Model assignment

Per issue #16: use a **smart model** (e.g. Gemini 3.1 Pro, Claude Opus) for semantic analysis. Focus on accuracy and low hallucination.

### Edge cases

| Case                       | Handling                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Empty diff                 | Return `changes: []`; no LLM call                                                                                  |
| Diff too large for context | Chunk diff; run two-stage (per-chunk descriptions → merge) or truncate with warning                                |
| LLM returns invalid JSON   | Retry with stricter prompt; fallback: return raw diff + "semantic extraction failed"                               |
| New PRD (100% new)         | Prompt: "This is a new PRD. Extract high-level semantic units (features, requirements, constraints) as additions." |

---

## Handoff to Step 4 (Architect)

The output of Step 3 (`SemanticChangeReport`) is the **input to the architect**:

- Architect receives: `SemanticChangeReport` (list of semantic changes).
- Architect's role: design how to go from current system state to the new state implied by these changes.
- Stakeholders for Step 7 (PR review) should be identified here and included in architect handoff — per issue #16: "INCLUDE SAME STAKEHOLDERS HERE AS IN STEP 7."

**Format for handoff:**

- Store `SemanticChangeReport` as JSON (e.g. `.cursor/logs/prd-semantic-{timestamp}.json`).
- Architect skill (or orchestrator) reads this file and uses it as the "scope" for the design doc and subsequent issues.

---

## File layout

```
prds/                           # Step 1: PRD root (per project)
  my-feature/
    PRD.md
  ...

scripts/
  prd-diff.ts (or .sh)          # Step 2: textual diff (git-based)
  prd-semantic-diff.ts          # Step 3: semantic extraction

specs/
  draft-spec-first-prd-diff/          # This design
    README.md
```

---

## Proposed work items

| #   | Item                   | Scope                                                                                                   |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | **Step 1: PRD layout** | Add `prds/` convention; document creation workflow                                                      |
| 2   | **Step 2 script**      | `prd-diff`: git diff (committed or local), discover `prds/**/PRD.md`, output `TextualChangeReport` JSON |
| 3   | **Step 3 script**      | `prd-semantic-diff`: LLM call, structured output, schema validation                                     |
| 4   | **Schema definitions** | TypeScript interfaces + JSON schema for `TextualChangeReport`, `SemanticChangeReport`                   |
| 5   | **Integration test**   | Sample PRD under `prds/` + edited version → run both steps → assert semantic output shape               |
| 6   | **Architect handoff**  | Update architect skill to accept `SemanticChangeReport` as input (separate follow-up)                   |

---

## Out of scope (this iteration)

- Steps 4–11 (architect, PM, workers, PRs, review, merge, release).
- PRD schema validation (e.g. enforcing PRD structure).
- Semantic diff for non-PRD documents.
- Streaming or incremental semantic extraction.

---

## References

- [Issue #16](https://github.com/JuroOravec/agents/issues/16) — Automate spec-first development workflow
- [Semantic diff operators](https://www.emergentmind.com/topics/semantic-diff-operators) — formal definitions, summarisation, witnesses
- Document revision analysis: diff-based representation, two-stage decomposition, chunking/clustering (ACL 2024 findings)

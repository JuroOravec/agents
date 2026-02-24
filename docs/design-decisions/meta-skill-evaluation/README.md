# Meta-Evaluation: Skill-Adherence Checks — Design

## Goal

Design a system to measure whether agents actually follow skill-defined workflows. For skills with clear phased sequences, we collect structured data as the agent executes each step, and record which phases were completed or skipped. This enables iterative improvement of skill text, detection of skill/model mismatch, and meta-level metrics over time to answer: "Are agents going in the right direction?"

**Design pivot:** Instead of inferring adherence from transcripts (error-prone, requires post-session scripts), the **agent calls a local CLI script** as it progresses through the workflow. The script creates and updates structured JSON files. This avoids agent JSON-editing errors (timestamps, corruption) and gives us explicit, perpetually logged data.

---

## Deep dive: Transcript access

### Where transcripts live

Agent transcripts are stored at:

```
~/.cursor/projects/{project-id}/agent-transcripts/{uuid}.txt
```

**Important:** Files are `.txt`, not `.jsonl`. The design previously assumed JSONL; that was incorrect.

**Project ID** is a hashed path (e.g. `Users-presenter-repos-agents` for the agents workspace). The `{uuid}` is the conversation/session identifier.

### Transcript format (observed)

Transcripts are **plain text** with a readable structure:

```
user:
<user_query>

{user message}

assistant:
<think>
...agent reasoning...
</think>

[Tool call] {ToolName}
  command: ...
  description: ...
[Tool result] {ToolName}
...

assistant:
...agent response text...
```

- Alternating `user:` / `assistant:` blocks
- Tool calls appear as `[Tool call] Name` with `command`, `description`, etc.
- Tool results as `[Tool result] Name` with output
- No formal schema; parsing would require regex or line-based heuristics

### What the `stop` hook provides

From Cursor hooks (meta-hook-create): the `stop` hook runs when a task completes. Its payload is:

```
{ "status": "completed" | "aborted" | "error" }
```

**No transcript, no messages, no tool history.** Session end does not provide the full conversation. We cannot rely on it for adherence analysis.

### Alternative: Cursor workspace storage

Cursor also stores chat history in SQLite (`state.vscdb`) under:

- **macOS:** `~/Library/Application Support/Cursor/User/workspaceStorage/{hash}/state.vscdb`
- Keys include `aiService.prompts`, `workbench.panel.aichat.view.aichat.chatdata`

This is workspace-level state, not per-conversation JSONL. Querying it requires opening the DB and reverse-engineering the schema. It is **not** the same as the `agent-transcripts` folder.

### Conclusion

- **Transcripts exist** at `~/.cursor/projects/{project-id}/agent-transcripts/{uuid}.txt`.
- Format is **text, not JSON**; parsing is feasible but brittle.
- **stop hook does NOT give transcript** — only status.
- Inferring "which step was completed" from transcript text would require fragile heuristics (tool names, phase mentions, etc.).

**Hence the pivot:** Have the agent call a CLI script (`skill-eval`) as it completes each step. The script writes structured JSON. No transcript parsing needed; data is explicit and real-time.

---

## Approach areas (from scope)

Per [issue #2](https://github.com/JuroOravec/agents/issues/2):

| Approach | Status |
| -------- | ------ |
| **3. Skill-adherence checks** | **first** — skill-eval CLI makes this straightforward |
| 1. Log-based review | later — capture-prompts now uses `last_turn_preview` from transcript; may revisit |
| 2. Synthetic regression tests | later |
| 4. Human-in-the-loop rating | later |
| 5. Proxy metrics | later |
| 6. A/B or cohort comparison | out of scope |

---

## First chunk: Skill-adherence checks (skill-eval CLI)

### Rationale: script instead of agent editing JSON

Asking the agent to (1) produce correct timestamps and (2) edit JSON without corrupting other parts is error-prone. Instead, we provide a **local CLI script** that the agent calls. The script handles file creation, timestamps, and atomic updates.

### Conversation ID and skill ID in context

**Both `conversation_id` and `skill_id` must live in the agent's context window.** A file-based approach (e.g. writing `conversation_id` to `.cursor/logs/current-session-id.txt`) would break with multiple agents running in parallel—they would overwrite each other's conversation_id.

We inject `conversation_id` via a **sessionStart** hook (or equivalent) that receives it from Cursor and adds it to the conversation context—e.g. as a system message or initial prompt—so the agent sees it and can pass it to the script. The agent passes `conversation_id` explicitly to `skill-eval start`. Similarly, the agent must preserve the `skill_id` returned by `start` and pass it to `complete`.

**Note:** Verify that Cursor exposes a sessionStart (or session start) hook and how to inject context. If not, we need an alternative.

### transcript_id removed

We do not use `transcript_id`. It was only relevant when reading transcript files; with the CLI approach we have no need for it.

### Multiple skill invocations per session

When the agent runs the same skill twice in one session (e.g. creates two issues), we need to distinguish them. A `skill_id` — a randomly generated UUID per invocation — solves this. Each `skill-eval start` creates a new skill_id and a new JSON file.

### skill-eval CLI

**Location:** `scripts/skill-eval.sh` in the **agents** repo.

**Commands:**

| Command | Purpose |
| ------- | ------- |
| `skill-eval start {conversation_id} {skill_name}` | Start a skill run; create JSON file; **print skill_id** to stdout |
| `skill-eval complete {skill_id} {phase_no} [--skipped]` | Record completion (or skip) of phase `phase_no` for that skill run |

**`skill-eval start {conversation_id} {skill_name}`:**
- Agent passes `conversation_id` (from context; injected by sessionStart) and `skill_name`
- Generates `skill_id` (e.g. UUID) randomly
- Creates JSON file: `.cursor/logs/skills/{timestamp}_{skill}_{skill_id}.json`
- Populates: `created_at` (from script timestamp), `conversation_id`, `skill_id`, `skill`, empty `steps`
- **Prints `skill_id` to stdout** — the agent must capture and preserve this in context
- Returns exit 0 on success

**`skill-eval complete {skill_id} {phase_no} [--skipped]`:**
- Finds the JSON file by glob: `*_{skill_id}.json`
- Appends to `steps`: `{ phase: phase_no, completed_at: <now> }` or, with `--skipped`: `{ phase: phase_no, completed_at: <now>, skipped: true }`
- Returns exit 0 on success

**Filename:** `{timestamp}_{skill}_{skill_id}.json` — e.g. `20260223T140000Z_act-repo-issue-create_a1b2c3d4.json`
- `timestamp`: filesystem sorts by time
- `skill`: human lookup
- `skill_id`: easy lookup via `*_{skill_id}.json`
- `conversation_id` is stored only inside the JSON as a field, not in the filename

### Agent workflow

1. **When starting a phased skill:** Run `skill-eval start {conversation_id} act-repo-issue-create` (pass `conversation_id` from context). Capture the printed `skill_id` from the terminal output.
2. **Preserve conversation_id and skill_id:** Both must remain in the agent's context window for the remainder of the workflow. Add a rule/skill note: *"If context gets summarized, ensure conversation_id and skill_id are preserved—they are required for skill-eval calls."*
3. **After each completed phase:** Run `skill-eval complete {skill_id} {phase_no}` (e.g. `skill-eval complete a1b2c3d4 1`, then `skill-eval complete a1b2c3d4 2`, etc.).
4. **For skipped phases:** Run `skill-eval complete {skill_id} {phase_no} --skipped`.

### Data model

| Field | Description |
| ----- | ----------- |
| `created_at` | ISO timestamp when `skill-eval start` ran |
| `conversation_id` | Passed by agent; stored in JSON only (not in filename) |
| `skill_id` | Random UUID per invocation; printed by `start`, used in `complete` |
| `skill` | Skill name (e.g. `act-repo-issue-create`) |
| `steps` | Array of `{ phase, completed_at }` or `{ phase, completed_at, skipped: true }` — script sets these |

**Step shape:**
- Completed: `{ "phase": 1, "completed_at": "2026-02-23T14:00:05Z" }`
- Skipped: `{ "phase": 1, "completed_at": "2026-02-23T14:00:05Z", "skipped": true }`

**Example:**

```json
{
  "created_at": "2026-02-23T14:00:00Z",
  "conversation_id": "abc-session-123",
  "skill_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "skill": "act-repo-issue-create",
  "steps": [
    { "phase": 1, "completed_at": "2026-02-23T14:00:05Z" },
    { "phase": 2, "completed_at": "2026-02-23T14:00:45Z", "skipped": true },
    { "phase": 3, "completed_at": "2026-02-23T14:01:10Z" }
  ]
}
```

### Tool log correlation (future)

Optionally, we can add **post-tool-use hooks** that log tool calls to `.cursor/logs/tools/` with timestamps. With `created_at` and `completed_at` in the skill JSON, we can correlate: "which tools were used during Phase 2?" This is a separate enhancement and not required for the first iteration.

---

## Prerequisite: Phase format enforcement (separate task)

For skill-eval tracking to be reliable, skills must have a consistent, parseable phase structure. This is a **separate task** from the skill-adherence design.

### Required

1. **All actionable steps** in a skill must live under `## Workflow` and use `### Phase N: Title` headings.
2. **Validation script** — Parses all `SKILL.md` files, checks for `### Phase \d+([ab])?: .+`, fails CI if any skill violates.
3. **meta-skill-create update** — Add explicit requirement: "Workflow MUST use `### Phase N: Title` for every step. This is enforced by CI."
4. **Audit existing skills** — Some skills have duplicate phase numbers (e.g. two `Phase 2`), or steps outside the Phase format. Fix before rolling out adherence tracking.

### Note in each skill

At the start of the `## Workflow` section, add:

> **Format:** All skills MUST use `### Phase N: Title` for each workflow step. Enforced by validation script in CI.

This task should be created as a separate GitHub issue and completed before or in parallel with the skill-eval CLI implementation.

---

## Definitions: completed / skipped / mishandled

With skill-eval data, we have explicit data:

- **Completed** — Step appears in `steps` with a non-null `completed_at`. Agent did the work and recorded it.
- **Skipped** — Agent calls `skill-eval complete {skill_id} {phase_no} --skipped`; step has `skipped: true` in the JSON. Or we infer "not in steps" as skipped.
- **Mishandled** — Wrong order (e.g. Phase 3 completed before Phase 2), or conflicting with skill rules. Detectable from `completed_at` ordering and phase sequence.

For the first iteration, we can keep it simple: **completed** = in `steps`, **skipped** = not in `steps` (with the caveat that the agent might have forgotten to log). Refinement can come later.

---

## Scope: First skill

**act-repo-issue-create** — 6 phases, relatively simple, good for pilot:

1. Classify  
2. Check for duplicates  
3. Discover labels  
4. Draft the issue  
5. Create  
6. Confirm  

Once this works, expand to act-dev, project-setup, role-architect, etc.

---

## Collection mechanism (summary)

| Aspect | Detail |
| ------ | ------ |
| **When** | Perpetual — agent calls `skill-eval start` then `skill-eval complete` as it goes. No manual trigger. |
| **Where** | `.cursor/logs/skills/{timestamp}_{skill}_{skill_id}.json` (`conversation_id` stored inside JSON) |
| **Script** | `scripts/skill-eval.sh` in the **agents** repo |
| **Who** | The agent (calls CLI); script handles file I/O, timestamps, skill_id generation |
| **Dependencies** | sessionStart hook to inject conversation_id into context; phase format enforcement; skill instructions to pass conversation_id, call script, and preserve conversation_id + skill_id in context |

---

## Analysis and visualization

- **Input:** JSON files in `.cursor/logs/skills/`.
- **Aggregation:** Script to read all files, group by skill, compute per-session adherence: `completed_steps / total_phases`.
- **Output:** CSV or JSONL for trending; simple dashboard later (heatmap skill × phase, adherence over time).

**Dashboard implemented:** `pnpm run preview` starts a local server at http://localhost:3040. The Skills page shows:
- **Heatmap** — skill × phase; cells gradient green (100%) to red (0%)
- **Line chart** — each skill over time; Y = 0–100% success rate
- Expected phase count comes from parsing `SKILL.md` files (same logic as `scripts/validate/skill-phases.ts`).

---

## Proposed work items

| # | Item | Status |
|---|------|--------|
| [#9](https://github.com/JuroOravec/agents/issues/9) | **Phase format enforcement** — `scripts/validate/skill-phases.ts`, meta-skill-create, CI | Done |
| [#10](https://github.com/JuroOravec/agents/issues/10) | **sessionStart hook** — Inject `conversation_id` into conversation context (no file—breaks with parallel agents) | Open |
| — | **skill-eval CLI** — `scripts/skill-eval.sh` | **Done** |
| [#11](https://github.com/JuroOravec/agents/issues/11) | **Add rule/skill instruction** — Pass conversation_id, preserve skill_id, call complete after each phase (depends on #10) | Done |
| [#12](https://github.com/JuroOravec/agents/issues/12) | **Aggregation script** — Read skills JSON, compute metrics, output CSV/JSONL | Open |

---

## Out of scope (this iteration)

- Extending `last_turn_preview` (e.g. more lines, different format) — capture-prompts now uses transcript; can extend as needed.
- Transcript parsing and inference-based adherence — replaced by agent-written JSON.
- Post-tool-use hooks for tool logging — optional future enhancement.
- Full skill rollout (act-dev, project-setup, etc.) — start with act-repo-issue-create only.

---

## Open questions

1. ~~**sessionStart hook** — Does Cursor expose a session start hook that receives `conversation_id`?~~ **Resolved:** Cursor exposes `sessionStart`; it receives `conversation_id` (which we inject as conversation_id) and can return `additional_context` to inject into the agent. See [session-id-injection.md](session-id-injection.md).
2. **Skill instruction placement** — Add to always-apply-skills, or to each phased skill individually, or a new rule that applies when a skill with phases is used?

# Agent and Tool Usage Tracking — Design

## 1. Goal

Track subagent runs and tool invocations in the agents repo, similar to skill usage tracking. This enables visibility into which subagents are used, how long they run, which tools are invoked and for how long, and how often tools fail. Use cases: meta-evaluation of agent behavior, debugging slow or failing workflows, and trend analysis over time.

**Constraints:** Conversation ID and parent-agent context are not available in these hooks. Design accordingly—record only what the hooks provide: subagent type, status, duration; tool name, input, duration, and (for failures) error type.

---

## 2. Data Model

### 2.1 Agent log entry (from subagentStop)

| Field           | Type   | Description                                              |
| --------------- | ------ | -------------------------------------------------------- |
| `finished_at`   | string | ISO 8601 UTC when the event was logged (end of subagent) |
| `event`         | string | `"subagentStop"`                                         |
| `subagent_type` | string | e.g. `"generalPurpose"`, `"architect"`                   |
| `status`        | string | `"completed"` \| `"error"`                               |
| `duration`      | number | Duration in milliseconds                                 |
| `started_at`    | string | Derived: `finished_at - duration` (ISO 8601 UTC)         |

**Example:**

```json
{
  "finished_at": "2026-02-23T14:05:00Z",
  "event": "subagentStop",
  "subagent_type": "generalPurpose",
  "status": "completed",
  "duration": 45000,
  "started_at": "2026-02-23T14:04:15Z"
}
```

### 2.2 Tool log entry — success (from postToolUse)

| Field         | Type   | Description                                            |
| ------------- | ------ | ------------------------------------------------------ |
| `finished_at` | string | ISO 8601 UTC when the event was logged                 |
| `event`       | string | `"toolUse"`                                            |
| `tool_name`   | string | e.g. `"Shell"`, `"Grep"`                               |
| `tool_input`  | object | Tool arguments (may contain sensitive data; log as-is) |
| `tool_use_id` | string | Cursor’s identifier for this invocation                |
| `cwd`         | string | Working directory when tool ran                        |
| `duration`    | number | Duration in milliseconds                               |
| `model`       | string | Model ID (e.g. `"claude-sonnet-4-20250514"`)           |
| `started_at`  | string | Derived: `finished_at - duration` (ISO 8601 UTC)       |

**Example:**

```json
{
  "finished_at": "2026-02-23T14:06:00Z",
  "event": "toolUse",
  "tool_name": "Shell",
  "tool_input": { "command": "npm test" },
  "tool_use_id": "abc123",
  "cwd": "/Users/me/proj",
  "duration": 5432,
  "model": "claude-sonnet-4-20250514",
  "started_at": "2026-02-23T14:05:54Z"
}
```

### 2.3 Tool log entry — failure (from postToolUseFailure)

| Field           | Type    | Description                                       |
| --------------- | ------- | ------------------------------------------------- |
| `finished_at`   | string  | ISO 8601 UTC when the event was logged            |
| `event`         | string  | `"toolUseFailure"`                                |
| `tool_name`     | string  | e.g. `"Shell"`, `"Grep"`                          |
| `tool_input`    | object  | Tool arguments                                    |
| `tool_use_id`   | string  | Cursor’s identifier                               |
| `cwd`           | string  | Working directory                                 |
| `duration`      | number  | Duration in milliseconds                          |
| `error_message` | string  | Human-readable error                              |
| `failure_type`  | string  | `"timeout"` \| `"error"` \| `"permission_denied"` |
| `is_interrupt`  | boolean | Whether the failure was user-initiated            |
| `started_at`    | string  | Derived: `finished_at - duration`                 |

**Example:**

```json
{
  "finished_at": "2026-02-23T14:07:00Z",
  "event": "toolUseFailure",
  "tool_name": "Shell",
  "tool_input": { "command": "npm test" },
  "tool_use_id": "abc123",
  "cwd": "/Users/me/proj",
  "duration": 5000,
  "error_message": "Command timed out after 30s",
  "failure_type": "timeout",
  "is_interrupt": false,
  "started_at": "2026-02-23T14:06:55Z"
}
```

---

## 3. Collection

### 3.1 Hook scripts

| Hook                 | Script                        | Log file                                      |
| -------------------- | ----------------------------- | --------------------------------------------- |
| `subagentStop`       | `.cursor/hooks/log-agents.sh` | `.cursor/logs/agents/agents-YYYY-MM-DD.jsonl` |
| `postToolUse`        | `.cursor/hooks/log-tools.sh`  | `.cursor/logs/tools/tools-YYYY-MM-DD.jsonl`   |
| `postToolUseFailure` | `.cursor/hooks/log-tools.sh`  | `.cursor/logs/tools/tools-YYYY-MM-DD.jsonl`   |

**Pattern:** Same as `capture-prompts.sh`: read JSON from stdin, use `jq` to build the output object, append one JSON line to the log file. One script can handle both `postToolUse` and `postToolUseFailure` by branching on hook event name.

### 3.2 Log format and paths

- **Format:** JSONL (one JSON object per line, append-only)
- **Rotation:** By date — e.g. `agents-2026-02-23.jsonl`, `tools-2026-02-23.jsonl`
- **Directories:** `mkdir -p` on first write

### 3.3 Hook script behavior

**log-agents.sh** (subagentStop):

1. Read payload from stdin
2. Extract `subagent_type`, `status`, `duration`
3. Compute `finished_at` = now (UTC)
4. Compute `started_at` = `finished_at - duration` (subtract duration ms)
5. Build object with `event: "subagentStop"`, append to `agents-YYYY-MM-DD.jsonl`

**log-tools.sh** (postToolUse, postToolUseFailure):

1. Read payload from stdin
2. Use `hook_event_name` to distinguish `postToolUse` vs `postToolUseFailure`
3. For both: extract `tool_name`, `tool_input`, `tool_use_id`, `cwd`, `duration`
4. For success: add `model`
5. For failure: add `error_message`, `failure_type`, `is_interrupt`
6. Compute `finished_at`, `started_at`
7. Set `event` to `"toolUse"` or `"toolUseFailure"`
8. Append to `tools-YYYY-MM-DD.jsonl`

### 3.4 hooks.json registration

Add entries for `subagentStop`, `postToolUse`, `postToolUseFailure`. See [meta-hook-create](/.cursor/skills/meta/hook-create/SKILL.md) for Cursor hook registration format.

---

## 4. Preview

### 4.1 Pages

Extend the existing preview server (`src/preview/`) with two new pages:

- **Agents** — `/agents` — table of subagent runs
- **Tools** — `/tools` — table of tool invocations (success + failure)

### 4.2 Table behavior (reuse crawlee-one pattern)

- **Default sort:** Most recent first (`finished_at` or `started_at` descending)
- **Sortable columns:** Click header to sort; support `field` / `-field` (desc) via query param
- **Filter:** Textarea with JavaScript expression; `obj` is the log entry. E.g. `obj.tool_name === 'Shell'`, `obj.duration > 5000`, `obj.failure_type === 'timeout'`
- **Pagination:** Page size 100, standard prev/next
- **Storage/loading:** Read JSONL files from `.cursor/logs/agents/` and `.cursor/logs/tools/`; parse line-by-line; merge files by date for full dataset

### 4.3 Implementation approach

- Add `loadAgentLogs(logDir)` and `loadToolLogs(logDir)` in `storage.ts` (or new module)
- Reuse or extract from crawlee-one: `createFilterFn`, `validateFilterScript`, `parseSortParam`, `getEntriesPageWithSort`-style logic
- Add `pageAgents` and `pageTools` in `pages.ts` — table with columns for each schema field
- Wire routes in `server.ts`: `GET /agents`, `GET /tools`
- Nav: add Agents and Tools links alongside Skills

### 4.4 Out of scope (v1)

- Stats tab (histograms, aggregates)
- Entry detail view (raw JSON for a single row)
- Correlation with skill-eval (would require conversation_id, which we don't have)

---

## 5. Issues

See [issues.md](./issues.md) for the concrete work items and GitHub issue numbers.

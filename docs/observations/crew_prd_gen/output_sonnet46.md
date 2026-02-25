---
# +-----------------------------------------+
# | Summary:
# |
# | Cost: $0.46 (OpenRouter)
# |
# | Models:
# | Smart: anthropic:claude-sonnet-4-6
# | Fast: anthropic:claude-sonnet-4-6
# | Base URL: https://openrouter.ai/api/v1
# |
# | Team: PRD Review Committee
# | Tasks: 2
# | Agents: 5
# |
# | Iterations: 9
# | Duration: 319.23 seconds
# | Input Tokens: 52863
# | Output Tokens: 19883
# |
# | Cost Input Tokens: $-1
# | Cost Output Tokens: $-1
# | Total Cost: $-1
# |
# | Calls Count: 9
# | Calls Error Count: 0
# | Parsing Errors: 0
# +-----------------------------------------+
# 
# Wrote: output.md
#  - Refined PRD: 8434 chars
#  - Outstanding questions: 9
---

# PRD: Wrapper Scripts for Safe `gh` Subcommand Allowlisting

**Document Version:** 1.1  
**Status:** Draft — Pending Stakeholder Review  
**Owner:** TBD  
**Priority:** Medium  
**Last Updated:** 2025-07-10  

---

## 1. Problem Statement

Cursor's tool allowlist operates at the **root command level** (e.g., `gh`), not at the subcommand level. This creates a binary and unsafe choice:

- **Option A — Allow `gh` broadly:** Grants access to all `gh` subcommands, including destructive ones such as `gh repo delete`, `gh repo archive`, and `gh secret set`. This is a critical security risk.
- **Option B — Block `gh` entirely:** Forces developers to seek manual approval every time they need a routine, safe operation such as `gh issue view` or `gh pr list`. This creates unacceptable workflow friction.

Neither option is acceptable. This PRD defines a third path.

---

## 2. Proposed Solution

Create a curated set of **thin shell wrapper scripts**, each of which hard-codes a single, pre-approved `gh` subcommand. These wrappers are added to Cursor's allowlist **in place of** the bare `gh` binary.

### How It Works

1. A wrapper script (e.g., `gh_issue_view`) is created that calls only `gh issue view`.
2. The wrapper name (`gh_issue_view`) is added to Cursor's allowlist.
3. Destructive subcommands (e.g., `gh repo delete`) have **no wrapper** and remain inaccessible to the AI agent.
4. The bare `gh` binary is **not** on the allowlist.

### Example Wrapper Script

```bash
#!/usr/bin/env bash
# gh_issue_view — Safe wrapper: invokes only 'gh issue view'
# Safe flags: issue number/URL, --json, --jq, --repo (read-only)
set -euo pipefail
exec gh issue view "$@"
```

---

## 3. Goals and Non-Goals

### Goals
- Give Cursor's AI agent access to a curated, safe subset of `gh` CLI functionality.
- Eliminate per-invocation approval prompts for pre-approved, read-only `gh` operations.
- Ensure all destructive `gh` subcommands remain fully blocked with no execution path for the AI agent.
- Establish a repeatable, maintainable pattern for expanding the approved command set over time.

### Non-Goals
- Does **not** replace or modify Cursor's underlying allowlist mechanism.
- Does **not** provide wrappers for write/mutate operations in v1.0 — those require a separate security review.
- Does **not** address allowlisting of other CLI tools beyond `gh`.

---

## 4. Scope — Initial Approved Wrapper Set (v1.0)

All v1.0 wrappers are **read-only** operations.

| Wrapper Script Name | Underlying Command | Description |
|---|---|---|
| `gh_issue_view` | `gh issue view` | View details of a specific issue |
| `gh_issue_list` | `gh issue list` | List issues in a repository |
| `gh_pr_view` | `gh pr view` | View details of a specific pull request |
| `gh_pr_list` | `gh pr list` | List pull requests in a repository |
| `gh_pr_status` | `gh pr status` | Show status of PRs relevant to the current user |
| `gh_repo_view` | `gh repo view` | View repository metadata |
| `gh_run_list` | `gh run list` | List recent workflow runs |
| `gh_run_view` | `gh run view` | View details of a specific workflow run |

> **Note:** This is the minimum viable set. Additions are governed by the process in Section 8.

---

## 5. Technical Specification

### 5.1 Script Location and Distribution

- All wrapper scripts SHALL be stored in `.cursor/bin/` within the project repository (pending confirmation — see Outstanding Questions).
- This directory SHALL be added to `PATH` via `.envrc` (direnv), dev container config, or an onboarding setup script.
- Scripts SHALL be committed to version control and subject to standard code review.

### 5.2 Script Construction Standards

Every wrapper script MUST:

1. Include `set -euo pipefail` — fail fast, no silent errors.
2. Hard-code exactly one `gh` subcommand — no dynamic command construction.
3. Pass arguments via `"$@"` with a comment header documenting expected safe flags.
4. Never use `sudo` or escalate privileges.
5. Use `#!/usr/bin/env bash` as the shebang for portability.

### 5.3 Allowlist Registration

- Each wrapper name SHALL be explicitly added to Cursor's allowlist configuration.
- The bare `gh` binary SHALL be explicitly absent from the allowlist — verified as part of the setup checklist.

### 5.4 Argument Injection Risk

- Wrappers pass `"$@"` to the hard-coded subcommand. An attacker cannot pivot to a different subcommand, bounding the risk to unexpected flags on a read-only operation.
- This risk level is accepted for v1.0 (read-only). Any future write-capable wrapper MUST implement explicit argument validation.

### 5.5 CLI Version Compatibility

- The minimum required `gh` CLI version MUST be documented in the repository (e.g., `.tool-versions` or `README.md`).
- A version compatibility assertion SHOULD be included in the CI pipeline or onboarding script.

---

## 6. Security Considerations

### 6.1 Tamper Prevention
- Wrapper scripts are version-controlled. All modifications require PR review, providing a full audit trail.
- Deployed script permissions SHALL be `755`. World-writable permissions (`777`) are prohibited.

### 6.2 Subcommand Containment
- Core security property: each wrapper hard-codes its subcommand, making subcommand pivoting impossible.
- This holds as long as (a) wrappers never construct commands dynamically, and (b) bare `gh` is not on the allowlist.

### 6.3 Audit Logging
- v1.0 relies on standard shell history and Cursor's native logging given the read-only scope.
- Teams with compliance requirements should see Outstanding Question #6.

### 6.4 Supply Chain
- `gh` CLI MUST be sourced from the official GitHub CLI distribution and verified per the organization's supply chain policy.

---

## 7. User Experience

### 7.1 Target Users
Developers using Cursor who need the AI agent to perform read-only GitHub queries (issues, PRs, CI runs) within automated or semi-automated workflows.

### 7.2 Onboarding
- The `README` SHALL document: how to add `.cursor/bin/` to PATH, how to verify setup, and the full list of available wrappers.
- First-time setup SHOULD take under 5 minutes.

### 7.3 Discoverability
- All wrappers follow the naming convention `gh_<subcommand_words_underscored>` — purpose is self-evident from the name.
- A `README` section SHALL serve as the canonical list of available wrappers.

### 7.4 Error Handling
- When a blocked command is attempted, Cursor denies it at the allowlist level.
- See Outstanding Question #7 regarding custom error messaging.

---

## 8. Process: Adding New Wrappers

New wrappers MUST NOT be added ad-hoc. The required process:

1. **Proposal** — Open a PR/issue describing the use case and the target subcommand.
2. **Security Classification** — Classify as read-only, write/mutate, or destructive. Destructive = permanently blocked. Write/mutate = elevated review required.
3. **Script Authoring** — Author the wrapper per Section 5.2 standards.
4. **Code Review** — Peer review with at least one security-aware reviewer.
5. **Allowlist Update** — On merge, add the wrapper name to Cursor's allowlist config.
6. **Documentation Update** — Update the `README` wrapper list and this PRD's Section 4.

---

## 9. Acceptance Criteria

- [ ] All 8 wrappers from Section 4 exist in `.cursor/bin/` and pass `bash -n` syntax check.
- [ ] Each wrapper contains `set -euo pipefail` and a descriptive comment header.
- [ ] Bare `gh` binary is confirmed absent from Cursor's allowlist.
- [ ] All 8 wrapper names from Section 4 are confirmed present in Cursor's allowlist.
- [ ] A developer can execute `gh_issue_list` after following documented onboarding steps, with no manual PATH changes required beyond documented setup.
- [ ] Attempting to invoke `gh repo delete` fails — no wrapper exists for it.
- [ ] `README` documents all available wrappers and the full setup procedure.
- [ ] Minimum required `gh` CLI version is documented in the repository.

---

## 10. Out-of-Scope for v1.0 (Future Considerations)

- Write/mutate wrappers (e.g., `gh issue create`, `gh pr merge`) — pending dedicated security review.
- Automated test harness for wrapper scripts.
- Centralized audit logging for wrapper invocations.
- Extending this pattern to other CLI tools (e.g., `git`, `aws`, `docker`).
- A code-generation utility to scaffold new wrapper scripts from a config file.

---

*Required approvals before implementation: Engineering Lead, Security Lead, Developer Experience Owner.*

---

## Outstanding questions

- What is the agreed-upon storage location for wrapper scripts? The PRD proposes `.cursor/bin/` — does the team have an existing convention (e.g., shared dotfiles repo, dev container, Homebrew-managed bundle) that should take precedence?
- What is the exact mechanism for adding the wrapper directory to PATH across all developer machines — direnv (.envrc), dev container configuration, a Makefile target, or a manual onboarding script?
- Is the proposed v1.0 wrapper set (8 read-only commands in Section 4) the correct and complete scope? Are there additional read-only `gh` subcommands required immediately that are missing from the list?
- Should write/mutate wrappers (e.g., `gh issue create`, `gh pr merge`) be planned for a v1.1 milestone? If so, what argument sanitization requirements and security review gates must be defined before any such wrapper can be approved?
- What is the minimum supported `gh` CLI version the wrappers must be compatible with, and how will this be enforced (version pinning in `.tool-versions`, CI assertion, or documentation-only)?
- Are there organizational compliance or audit requirements mandating centralized logging of AI agent tool invocations? If yes, what logging infrastructure (e.g., Datadog, Splunk, CloudWatch) should wrapper invocations report to?
- Can Cursor's allowlist be configured to surface a custom, human-readable error message when a blocked command is attempted — directing the user to the approved wrapper list? If so, who owns that configuration?
- Who is the designated long-term owner and maintainer of the wrapper script set and the allowlist configuration, and what is the expected turnaround time for reviewing and approving new wrapper proposals?
- What is the target delivery date or sprint milestone for the v1.0 implementation of this feature?

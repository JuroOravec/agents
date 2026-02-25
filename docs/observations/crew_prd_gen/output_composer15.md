---
# +-----------------------------------------+
# | Summary:
# |
# | Cost: UNKNOWN (Cursor)
# |
# | Models:
# | Smart: cursor:composer-1-5
# | Fast: cursor:composer-1-5
# | Base URL: https://openrouter.ai/api/v1
# |
# | Team: PRD Review Committee (Cursor CLI)
# | Tasks: 2
# | Agents: 5
# |
# | Iterations: 3
# | Duration: 51.649 seconds
# | Input Tokens: 0
# | Output Tokens: 0
# |
# | Cost Input Tokens: $0
# | Cost Output Tokens: $0
# | Total Cost: $0
# |
# | Calls Count: 0
# | Calls Error Count: 0
# | Parsing Errors: 0
# +-----------------------------------------+
#
# Wrote: output_composer15.md
#  - Refined PRD: 7170 chars
#  - Outstanding questions: 7
---

# Feature: Tiny Wrapper Scripts for Safe gh Subcommands

## Summary

Cursor's allowlist recognizes commands at the root level (e.g., `gh`), not subcommands. Allowing `gh` broadly is dangerous (e.g., `gh repo delete`). Requiring approval for safe read-only commands every time creates friction.

## Solution

Create small wrapper scripts (e.g., `gh_issue_view`) that invoke only approved subcommands. Add wrapper names to the allowlist instead of `gh`. Dangerous commands stay blocked because they have no wrapper.

## Project Classification

**Discovery vs. implementation**: This is a user-side workaround / tooling feature, not a core Cursor product change. Ownership is the team providing the tooling; scope is bounded by the enumerated wrappers below.

---

## Scope

### In-Scope Wrappers (Definitive List)

The following wrappers are in scope for v1:

| Wrapper Name | Invokes | Notes |
|--------------|---------|-------|
| `gh_issue_view` | `gh issue view` | View issue details |
| `gh_issue_list` | `gh issue list` | List issues |
| `gh_pr_view` | `gh pr view` | View PR details |
| `gh_pr_list` | `gh pr list` | List PRs |
| `gh_repo_view` | `gh repo view` | View repo info |
| `gh_run_view` | `gh run view` | View workflow run |
| `gh_run_list` | `gh run list` | List workflow runs |

Additional subcommands may be added via the maintenance process (see § Maintenance Model).

### Out of Scope

- `gh` extensions (not covered by wrappers)
- Any subcommand not explicitly enumerated above
- Commands that mutate data, delete resources, or trigger workflows

---

## Definition of "Safe"

A subcommand is considered **safe** if it meets all of the following:

1. **Read-only**: No create, update, delete, or write operations
2. **No workflow triggers**: Does not start workflows, deployments, or approvals
3. **No destructive actions**: Does not revoke access, transfer ownership, or modify settings
4. **Low sensitivity by default**: Outputs are visible to users with existing repo access; no new secrets or tokens exposed

**Note**: Read-only commands can still expose confidential data to users with repo access. Data classification and access controls remain the user's/organization's responsibility; wrappers do not add or remove access.

---

## Implementation Specification

### Platform & Language

- **Unix/macOS/Linux**: Shell scripts (POSIX-compliant `sh` or `bash`), executable via `#!/usr/bin/env sh`
- **Windows**: Batch (`.bat`) or PowerShell (`.ps1`) equivalents; provide both for compatibility
- Scripts must be small, single-purpose, and easy to audit

### Argument Handling

- Wrappers forward all arguments to the underlying `gh` subcommand (e.g., `gh_issue_view 123 --json title` → `gh issue view 123 --json title`)
- Use `"$@"` (or equivalent) to forward arguments without parsing or interpretation; avoid string concatenation that could enable argument injection
- No user input sanitization beyond proper quoting; `gh` CLI handles its own parsing

### Installation & PATH

- Scripts live in a single directory (e.g., `~/.local/bin/gh-wrappers/` or project-specific `tools/gh-wrappers/`)
- That directory must be on the user's PATH before Cursor invokes commands
- Installation: provide a script or package that copies wrappers and updates PATH (or instructs the user to do so)
- Document the installation path in user-facing docs

### Invocation

- Users and Cursor invoke wrappers by name (e.g., `gh_issue_view`)
- Wrappers must be resolvable via PATH when Cursor runs them

---

## Success Criteria

1. **Coverage**: All in-scope wrappers (7 for v1) implemented and tested on Unix and Windows
2. **Functional parity**: Wrappers behave identically to `gh <subcommand>` for allowed use cases
3. **Allowlist integration**: Users can add wrapper names to Cursor's allowlist and run them without approval
4. **Documentation**: Install guide, wrapper catalog, and mapping (`gh_issue_view` ↔ `gh issue view`) published
5. **Adoption (optional metric)**: Track usage or feedback; target TBD based on available telemetry

---

## Maintenance Model

- **Ownership**: TBD; assign an owner (team or individual) in project setup
- **Process for adding wrappers**:
  1. Propose new subcommand with safety justification against the Definition of Safe
  2. Review and approve
  3. Implement wrapper; add to catalog; update docs
- **Process for deprecating**: Document deprecation, provide migration path (e.g., back to `gh` with approval), remove from catalog
- **Sync with gh releases**: Owner reviews `gh` release notes for new subcommands and changes; add or adjust wrappers as needed

---

## Security Considerations

### Trust Model

- Wrappers are assumed to live in user- or org-controlled paths. Users are responsible for ensuring those paths are trusted and not tampered with.
- If wrappers are distributed via a package or install script, use integrity checks (e.g., checksums) where feasible.

### Argument Injection

- Forward arguments only via proper quoting (`"$@"`); do not build command strings from user input.
- Wrappers run with the same privileges as the caller; no additional sandboxing specified.

### Audit Logging

- Wrapper usage is not logged by default. Organizations that need audit trails should configure logging at the Cursor or shell level.

---

## User Experience & Discoverability

### Documentation

- Provide a **wrapper catalog** listing each wrapper, its `gh` equivalent, and example usage
- Include an **installation guide** (clone/copy, PATH setup, allowlist configuration)
- Add **migration guidance** for users currently using `gh` directly

### Error Handling

- If a wrapper fails (e.g., `gh` not installed, network error), surface the underlying `gh` error to the user
- If a user runs a non-existent wrapper, document expected behavior (e.g., "command not found")

### Adoption

- Communicate via release notes, internal wiki, or team channels
- Document that wrappers use a different syntax (`gh_issue_view` vs `gh issue view`) and point users to the catalog for mapping
- Note that tab completion and shell integration may differ from native `gh`; document known limitations

---

## Rollout & Rollback

### Rollout

- **Phase 1**: Ship wrappers and documentation; opt-in adoption
- **Phase 2**: Optional—promote to default for specific teams or repos; timeline TBD
- **Distribution**: Per-repo (in repo `tools/`) or global (user install); support both patterns in docs

### Rollback

- If wrappers cause issues: users remove them from PATH and/or allowlist and revert to using `gh` with approval
- No automatic rollback; document manual steps for disabling wrappers

---

## Assumptions & Dependencies

- **Cursor allowlist**: Matches on root command name; subcommands are not matched. This behavior is assumed for the design.
- **Allowlist control**: Users or orgs can add wrapper names to the allowlist without Cursor product changes.
- **gh CLI**: Installed and available on PATH when wrappers run.

---

## Open Risks

- If Cursor changes allowlist behavior (e.g., subcommand support), this approach may need revision.
- Maintenance overhead grows with the number of wrappers and `gh` subcommands.

---

## Outstanding questions

- Does Cursor's allowlist currently support only root-level commands? Is this behavior documented or stable?
- Who controls the allowlist (Cursor product, org policy, or user config)? Can wrapper names be added without Cursor product changes?
- What is the exhaustive set of gh subcommands that should be classified as safe vs dangerous? (The PRD provides criteria and an initial list; a full audit may reveal additional candidates.)
- Is this intended as a temporary workaround or a long-term feature? How does it align with Cursor's product roadmap?
- What quantified benefit (e.g., % reduction in approval prompts, time saved) should we target? Data is needed to set and validate success metrics.
- Who owns maintenance of the wrappers? (Team or individual assignment required.)
- How will users be informed about wrappers and encouraged to adopt them? (Product/UX decision on channels and messaging.)

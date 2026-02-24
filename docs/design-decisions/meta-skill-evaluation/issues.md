# Meta-evaluation: Issues created

Issues created 2026-02-23. Umbrella: [#2](https://github.com/JuroOravec/agents/issues/2).

- #9 Phase format enforcement
- #10 sessionStart hook (session_id injection)
- #11 Add skill-eval rule (skill-eval CLI done)
- #12 Aggregation script

Legacy drafts below (for reference).

---

## 1. Phase format enforcement

```bash
gh issue create --title "Phase format enforcement for skills: validation script and audit" --label "enhancement" --body "## Summary

Enforce \`### Phase N: Title\` format across all skills so skill-eval tracking can reliably parse phase structure.

## Notes

- Validation script parses all SKILL.md files, checks for \`### Phase \\d+([ab])?: .+\`, fails CI if violated
- Update meta-skill-create to require this format
- Audit existing skills for duplicates (e.g. two Phase 2), steps outside Phase format
- Add note at start of Workflow section in each skill: format enforced by CI

Part of meta-evaluation (issue #2). Design: \`docs/design-decisions/meta-skill-evaluation/\`."
```

---

## 2. sessionStart hook

```bash
gh issue create --title "Inject session_id into context via sessionStart hook" --label "enhancement" --body "## Summary

Session_id must be in the agent's context (not a file—file breaks with parallel agents). Create sessionStart hook to inject session_id into the conversation context so agents can pass it to skill-eval start.

## Notes

- Verify if Cursor exposes sessionStart (or equivalent)
- If not, document fallback (e.g. beforeSubmitPrompt + conversation_id)
- No file-based approach—parallel agents would overwrite each other

Part of meta-evaluation (issue #2). Design: \`docs/design-decisions/meta-skill-evaluation/\`."
```

---

## 3. skill-eval rule (skill-eval CLI is implemented)

```bash
gh issue create --title "Add skill-eval rule and act-repo-issue-create phase logging" --label "enhancement" --body "## Summary

Tell agents to call skill-eval when following act-repo-issue-create: start at workflow begin, complete after each phase (with --skipped for skips). Preserve session_id and skill_id in context across summarization.

## Notes

- skill-eval CLI is implemented at \`scripts/skill-eval.sh\`
- Start with act-repo-issue-create only
- Rule or skill update: pass session_id to start, capture skill_id, preserve both IDs
- Placement: always-apply-skills vs each phased skill vs new rule—TBD

Part of meta-evaluation (issue #2). Design: \`docs/design-decisions/meta-skill-evaluation/\`."
```

---

## 4. Aggregation script

```bash
gh issue create --title "Implement skill-eval aggregation script for adherence metrics" --label "enhancement" --body "## Summary

Read \`.cursor/logs/skills/*.json\`, compute adherence metrics (completed/total per session, per skill), output CSV/JSONL for trending.

Part of meta-evaluation (issue #2). Design: \`docs/design-decisions/meta-skill-evaluation/\`."
```

# Spec-First PRD Pipeline: Textual and Semantic Change Detection — Design

## Executive Summary

This PRD defines the implementation of a spec-first development pipeline that automatically detects and processes changes in Product Requirements Documents (PRDs). The system will enable teams to track semantic changes in requirements and automatically trigger downstream development workflows.

**Success Metrics:**

- 95% accuracy in detecting semantic changes vs manual review
- Sub-30 second processing time for typical PRD changes
- Zero false negatives for critical requirement changes
- Developer adoption rate >80% within 3 months

## Goal

Design and implement **Step 1** (PRD structure and creation), **Step 2** (detect textual changes), and **Step 3** (derive semantic changes) from [issue #16](https://github.com/JuroOravec/agents/issues/16). These steps feed the spec-first development pipeline: PRD → textual diff → semantic diff → architect → PM & workers → PRs → review → merge → release.

**Scope:** Steps 1–3. Step 4 (architect handoff) and later are explicitly out of scope for this design phase.

## Context: Spec-first pipeline

| Step  | Purpose                                                                   | Owner          | SLA  |
| ----- | ------------------------------------------------------------------------- | -------------- | ---- |
| **1** | **PRD structure and creation** — standardized PRD format and organization | Product Team   | N/A  |
| **2** | **Detect textual changes in PRD** — git as source of truth                | Dev Tools      | <30s |
| **3** | **Derive semantic changes** — extract meaningful business changes         | AI/ML Pipeline | <60s |
| 4+    | Architect, PM, workers, PRs, review, merge, release                       | Various        | TBD  |

## User Stories

### Primary Users: Product Managers

- **As a PM**, I want to update a PRD and automatically get a summary of semantic changes, so I can communicate impact to stakeholders
- **As a PM**, I want the system to flag breaking changes, so I can assess implementation complexity

### Secondary Users: Developers

- **As a developer**, I want to see what actually changed in requirements (not just text diffs), so I can understand implementation needs
- **As a developer**, I want the system to work with my existing git workflow, so adoption is seamless

### Tertiary Users: Architects

- **As an architect**, I want structured semantic changes as input, so I can design appropriate technical solutions

## Step 1: PRD Structure and Creation

### Folder Layout Standards

Use a top-level `prds/` directory with standardized structure:

```
prds/
├── feature-name/              ← kebab-case naming
│   ├── PRD.md                 ← REQUIRED: main specification
│   ├── assets/                ← OPTIONAL: diagrams, mockups
│   ├── research/              ← OPTIONAL: user research, analysis
│   └── archive/               ← OPTIONAL: deprecated versions
├── another-feature/
│   └── PRD.md
└── platform/
    └── authentication/
        └── PRD.md
```

**Constraints:**

- Maximum nesting depth: 3 levels
- Each feature directory MUST contain `PRD.md`
- Feature names must be kebab-case, alphanumeric + hyphens only
- Total path length <255 characters (Windows compatibility)

### PRD Template Requirements

Each `PRD.md` must follow this structure:

```markdown
# Feature Name

## Executive Summary

[1-2 paragraphs, business value, success metrics]

## User Stories

[Primary user workflows]

## Requirements

### Functional Requirements

### Non-Functional Requirements

### Constraints

## Dependencies

[Internal/external dependencies]

## Success Metrics

[Measurable success criteria]

## Implementation Notes

[Technical guidance for architects]
```

### Creation Workflow

1. **Initialize**: Copy template to `prds/feature-name/PRD.md`
2. **Validate**: Run `prd-validate` script to check structure
3. **Review**: Standard PR review process
4. **Commit**: Initial commit establishes baseline for change tracking

## Step 2: Detect Textual Changes in PRD

### Detection Strategy

**Primary Source:** Git diff as single source of truth
**Supported Scenarios:**

| Scenario        | Comparison             | Use Case           | Command                   |
| --------------- | ---------------------- | ------------------ | ------------------------- |
| **Post-commit** | HEAD vs HEAD~1         | CI/CD pipeline     | `git diff HEAD~1 HEAD`    |
| **Pre-commit**  | Working tree vs HEAD   | Developer workflow | `git diff HEAD`           |
| **PR Review**   | Feature branch vs main | Code review        | `git diff main...feature` |

### Data Collection Schema

```typescript
interface TextualChangeReport {
  prd_path: string;
  diff_mode: 'committed' | 'local' | 'pr_review';
  baseline_ref: string | null; // e.g. "HEAD~1", null for new files
  target_ref: string; // e.g. "HEAD", "working_tree"
  is_new_prd: boolean;
  diff: string; // unified diff (git format)
  current_content: string; // full current PRD text
  baseline_content: string | null; // full baseline text, null if new
  metadata: {
    file_size_bytes: number;
    lines_added: number;
    lines_removed: number;
    timestamp: string; // ISO 8601
    commit_hash?: string;
  };
}
```

### Implementation: CLI Script

**File:** `scripts/prd-diff.ts`

**Usage:**

```bash
# Auto-discover all PRDs, check working tree vs HEAD
./scripts/prd-diff.ts

# Specific PRD, committed changes
./scripts/prd-diff.ts --prd prds/auth/PRD.md --mode committed

# PR review mode
./scripts/prd-diff.ts --base main --head feature-branch
```

**Error Handling:**

- Missing PRD file: Exit code 1, clear error message
- Git repository not found: Exit code 2, suggest `git init`
- Binary files: Exit code 3, "PRD must be text file"
- Permission errors: Exit code 4, suggest permission fix

### Performance Requirements

- Process time: <5 seconds for PRDs up to 10MB
- Memory usage: <100MB peak
- Support for repositories with >10,000 commits

## Step 3: Derive Semantic Changes

### Semantic Change Classification

```typescript
interface SemanticChange {
  id: string; // UUID v4
  type: 'addition' | 'modification' | 'removal' | 'restructure';
  category: 'functional' | 'non_functional' | 'business' | 'technical';
  severity: 'low' | 'medium' | 'high' | 'critical';
  summary: string; // <100 chars, human readable
  description: string; // Detailed explanation
  before?: string; // Previous state (for mod/removal)
  after?: string; // New state (for add/modification)
  rationale?: string; // Why this change matters
  affected_sections: string[]; // PRD sections impacted
  implementation_complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
  breaking_change: boolean; // Requires API/contract changes
}

interface SemanticChangeReport {
  prd_path: string;
  is_new_prd: boolean;
  processing_timestamp: string; // ISO 8601
  changes: SemanticChange[];
  summary: {
    total_changes: number;
    breaking_changes: number;
    complexity_distribution: Record<string, number>;
  };
  confidence_score: number; // 0.0-1.0, LLM confidence
  raw_diff_ref?: string; // Reference to original diff
}
```

### LLM Processing Strategy

**Multi-Agent Approach:**

1. **Primary Extractor** (Gemini 2.0 Pro): Initial semantic analysis
2. **Reviewer** (Claude 3.5 Sonnet): Validate and critique extraction
3. **Consolidator** (GPT-4): Merge feedback into final report

**Processing Pipeline:**

```
Textual Diff → Primary Extraction → Review & Critique → Consolidation → Final Report
```

**Prompt Engineering:**

- Include full PRD context, not just diff
- Request structured JSON output with schema validation
- Emphasize business impact over cosmetic changes
- Provide examples of good vs bad semantic changes

**Error Handling:**

- LLM API timeout: Retry with exponential backoff (max 3 attempts)
- Invalid JSON response: Fallback to simplified extraction
- Context length exceeded: Implement chunking strategy
- API rate limits: Queue requests with appropriate delays

### Security Considerations

**Data Privacy:**

- PRD content may contain sensitive business information
- LLM API calls must use encrypted connections (TLS 1.3+)
- No persistent storage of PRD content in external services
- Local processing preferred where feasible

**Access Control:**

- API keys stored in secure environment variables
- Role-based access to PRD directories
- Audit logging for all semantic analysis requests

**Compliance:**

- GDPR compliance for EU-based teams
- SOC 2 Type II requirements for enterprise usage

## Integration and Deployment

### CI/CD Integration

```yaml
# .github/workflows/prd-diff.yml
name: PRD Change Detection
on:
  pull_request:
    paths: ['prds/**/*.md']

jobs:
  detect_changes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 2 # Need previous commit
      - name: Detect PRD Changes
        run: |
          ./scripts/prd-diff.ts --mode pr_review --base ${{ github.base_ref }} --head ${{ github.head_ref }}
          ./scripts/prd-semantic-diff.ts --input diff-report.json
      - name: Comment PR
        uses: actions/github-script@v6
        with:
          script: |
            // Post semantic changes as PR comment
```

### Monitoring and Alerting

**Key Metrics:**

- Processing success rate
- Average processing time
- LLM API error rates
- False positive/negative rates (manual validation)

**Alerting Thresholds:**

- Processing failure rate >5%
- Average processing time >60 seconds
- LLM API error rate >10%

### Rollout Strategy

**Phase 1 (Weeks 1-2):** Core team dogfooding

- 5 team members, 2 test PRDs
- Manual validation of all semantic extractions
- Bug fixes and UX improvements

**Phase 2 (Weeks 3-4):** Extended team

- 20 team members, production PRDs
- Automated monitoring enabled
- Performance optimization

**Phase 3 (Weeks 5-8):** Full rollout

- All teams, CI/CD integration
- Self-service documentation
- Success metrics tracking

## Handoff to Step 4 (Architect)

**Input Format:** `SemanticChangeReport` JSON
**Storage Location:** `.cursor/logs/prd-semantic-{timestamp}.json`
**Stakeholder Notification:** Automatically notify architect + original PRD author

**Handoff Trigger Conditions:**

- Any "high" or "critical" severity changes
- Any breaking changes detected
- > 3 "moderate" complexity changes in single update
- Manual trigger via `--force-handoff` flag

## File Structure

```
prds/                              # Step 1: PRD root
├── feature-a/
│   └── PRD.md
└── feature-b/
    └── PRD.md

scripts/
├── prd-diff.ts                    # Step 2: textual diff detection
├── prd-semantic-diff.ts           # Step 3: semantic extraction
├── prd-validate.ts                # PRD structure validation
└── lib/
    ├── git-utils.ts               # Git interaction helpers
    ├── llm-client.ts              # LLM API abstraction
    └── schemas.ts                 # TypeScript/JSON schemas

.cursor/
├── logs/
│   └── prd-semantic-*.json        # Semantic change reports
└── config/
    └── prd-pipeline.json          # Configuration

docs/
└── prd-pipeline/
    ├── README.md                  # User guide
    ├── troubleshooting.md         # Common issues
    └── api-reference.md           # Script usage
```

## Testing Strategy

**Unit Tests:**

- Git diff parsing accuracy
- PRD discovery logic
- Schema validation
- Error handling scenarios

**Integration Tests:**

- End-to-end pipeline: PRD change → semantic report
- LLM API integration (mocked for CI)
- Git workflow scenarios

**Performance Tests:**

- Large PRD processing (>1MB files)
- Multiple concurrent requests
- Memory usage under load

**User Acceptance Tests:**

- Manual validation of semantic accuracy
- Developer workflow integration
- Edge case handling

## Risk Assessment

| Risk                           | Probability | Impact   | Mitigation                           |
| ------------------------------ | ----------- | -------- | ------------------------------------ |
| LLM API rate limits            | High        | Medium   | Local caching, queue management      |
| Inaccurate semantic extraction | Medium      | High     | Multi-agent validation, human review |
| Git repository corruption      | Low         | High     | Readonly operations, error handling  |
| Performance degradation        | Medium      | Medium   | Monitoring, optimization, timeouts   |
| Security breach (API keys)     | Low         | Critical | Secure storage, rotation, auditing   |

## Success Criteria

**Functional Requirements Met:**

- ✅ Detect textual changes in PRDs via git diff
- ✅ Extract semantic changes using LLM analysis
- ✅ Provide structured output for downstream systems
- ✅ Support common developer workflows

**Non-Functional Requirements Met:**

- ✅ Process typical PRD changes in <30 seconds
- ✅ Achieve >95% semantic accuracy vs manual review
- ✅ Handle PRDs up to 10MB
- ✅ Support concurrent processing
- ✅ Maintain security and compliance standards

**Business Requirements Met:**

- ✅ Enable faster development cycles
- ✅ Reduce manual change analysis overhead
- ✅ Improve requirement change communication
- ✅ Support spec-first development methodology

---

## Outstanding questions

- What is the specific budget allocated for LLM API usage and monthly cost limits?
- Which LLM providers are approved for use in this organization (security/compliance requirements)?
- What are the specific data residency requirements for PRD content processing?
- Who are the designated stakeholders for Step 7 (PR review) that need to be included in architect handoff notifications?
- What is the organization's preferred authentication method for LLM API access (service accounts, personal keys, etc.)?
- Are there existing enterprise agreements with LLM providers that affect pricing or rate limits?
- What specific compliance frameworks must this system adhere to (SOC 2, GDPR, HIPAA, etc.)?
- What is the maximum acceptable processing time for semantic analysis in the production environment?
- Should the system support multiple languages for PRDs or only English?
- What existing monitoring and alerting infrastructure should this integrate with?
- Are there organizational standards for TypeScript/Node.js versions that must be followed?
- What is the rollback strategy if semantic analysis accuracy falls below acceptable thresholds?

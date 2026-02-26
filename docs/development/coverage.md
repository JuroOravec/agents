# Test Coverage

Test coverage is enforced by the **check pipeline** (Phase 5: Tests & Coverage). The pipeline runs `npm run coverage`, which executes Vitest with the V8 coverage provider and fails if thresholds are not met.

## What coverage checks

- **Lines** — Minimum 40% of lines must be executed by tests
- **Statements** — Minimum 40%
- **Branches** — Minimum 35%
- **Functions** — Minimum 40%

Thresholds are configured in `vitest.config.ts`. Start conservative and ratchet up over time (see `act-dev-coverage` skill).

## Scope

Coverage is collected for:

- `src/**/*.ts` — library and engine code
- `scripts/**/*.ts` — CLI and command scripts

Excluded:

- Test files (`**/*.test.ts`)
- `crawlee-one/` and other nested projects
- `node_modules/`, `dist/`, `coverage/`
- Generated files (`**/__generated__/**`)

## Running coverage

```bash
pnpm run coverage   # Run tests with coverage; fails if thresholds not met
pnpm run test       # Run tests only (no coverage report or threshold check)
```

Coverage report is written to `coverage/` (text and lcov). The lcov output can be used by CI dashboards and badge services.

## Improving coverage

See the `act-dev-coverage` skill for a phased methodology: audit → source analysis → mock infrastructure → unit tests → integration tests → ratchet thresholds.

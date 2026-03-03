# Knip: Dead Code and Unused Exports

Knip analyzes the project to find dead code, unused exports, unused files, and unused dependencies. It runs as part of the **check pipeline** (Phase 3: Dead Code) and also via `pnpm run knip`.

## What Knip checks

- **Unused exports** — Functions, variables, or constants exported but never imported anywhere
- **Unused files** — Files not reachable from any entry point
- **Unused dependencies** — Packages in `package.json` that are never imported
- **Unresolved imports** — Imports that don't resolve
- (Types are excluded; see below)

## How it works

Knip builds a module graph from your **entry points** and traces what is actually used. Unlike ESLint (which analyzes files in isolation), Knip sees the whole project. Something exported from `foo.ts` is "unused" only if nothing in the graph imports it.

Entry points are configured in `knip.json`: library entry (`src/index.ts`), CLI (`src/commands/cli.ts`), scripts (`scripts/demo-worker.ts`, `scripts/demo-prd-review.ts`, `scripts/commands/*.ts`), Mastra patterns, and validation scripts.

## Excluded: types

The project uses `knip --exclude types`, so **unused exported types** are not reported. Exported options interfaces (e.g. `FanOutOptions`) are typically kept for API consumers even when not imported internally; TypeScript inlines their shape in `.d.ts` anyway. Reporting them adds noise, so they're excluded.

To report types as well, remove `--exclude types` from the `knip` script in `package.json`.

## Making exceptions (bypassing false positives)

### 1. `@public` JSDoc tag

Mark an export as intentionally part of the public API. Knip will not report it as unused.

```typescript
/**
 * Options for the fan-out workflow.
 * @public
 */
export interface FanOutOptions {
  reviewers: ReviewerConfig[];
}
```

### 2. Custom tag (e.g. `@lintignore`)

Use any tag and tell Knip to ignore it in `knip.json`:

```typescript
/** @lintignore */
export const experimentalHelper = () => {};
```

In `knip.json`:

```json
{
  "tags": ["-lintignore"]
}
```

### 3. Export from an entry file

Exports from entry files (e.g. `src/index.ts`, `src/mastra/patterns/index.ts`) are considered used by external consumers. Re-export options types from your barrel files if they're meant to be part of the public API.

### 4. Exclude specific issue types globally

Add to `knip.json` to ignore whole categories:

```json
{
  "exclude": ["types", "classMembers"]
}
```

Or run once with flags: `pnpm knip -- --exclude types`.

## Configuration

- **Config file:** `knip.json` at repo root
- **Entry patterns** — Define what counts as a program entry; everything else must be reachable from these
- **Project patterns** — Files to analyze (`src/**/*.ts`, `scripts/**/*.ts`, `specs/**/*.ts`)
- **ignoreDependencies** — Packages to never flag (e.g. `@vitest/coverage-v8`, used dynamically by Vitest)

## Running Knip

```bash
pnpm run knip          # Full report (exits 1 if issues found)
pnpm run check         # Includes Knip as Phase 3: Dead Code
```

## Further reading

- [Knip docs](https://knip.dev/)
- [JSDoc / TSDoc tags](https://knip.dev/reference/jsdoc-tsdoc-tags) — `@public`, `@internal`, `@alias`, custom tags

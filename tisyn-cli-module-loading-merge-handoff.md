# CLI Module Loading Merge Handoff

Base:
- repo: `/Users/tarasmankovski/Repositories/cowboyd/tisyn`
- worktree: `/Users/tarasmankovski/Repositories/cowboyd/tisyn/worktrees/cli-module-loading-merge`
- branch: `docs/cli-module-loading-merge`
- base commit: `da32e19` (`Merge pull request #77 from taras/feat/tisyn-demo-migration`)

Imported source:
- `specs/tisyn-cli-module-loading-merge.md` is copied from `/Users/tarasmankovski/Downloads/tisyn-cli-module-loading-merge.md`

## Summary

This branch is for merging the standalone TypeScript
module-loading design into the CLI spec and then
implementing the CLI-facing parts of that design.

Current repo state already has part of the shape:

- `packages/cli/src/load-descriptor.ts` loads descriptor
  modules and precompiled workflow modules with native
  `import()` only
- `packages/cli/src/startup.ts` loads local/inprocess
  transport bindings with native `import()` only
- `packages/cli/src/run.ts` already distinguishes
  descriptor loading from workflow source compilation,
  but only by checking `workflowPath.endsWith(".ts")`
- root `package.json` has a devDependency on `tsx`, but
  `packages/cli/package.json` does not declare `tsx` as
  a direct runtime dependency

The merge note says the CLI spec can move now without a
secondary runtime-spec amendment. Treat the future
`Runtime.loadModule` / `Runtime.around()` shape as
architectural alignment text only on this branch unless a
real in-repo consumer appears and forces the issue.

## Branch-Level Decisions

- Keep this branch narrow: update the CLI spec, implement
  bootstrap module loading for CLI-owned call sites, add
  focused tests, and update CLI package metadata/docs as
  needed.
- Do not introduce a public `Runtime` context API on this
  branch just because §10.5.6 mentions it. The merge note
  explicitly says that normative runtime-side definition is
  deferred.
- Preserve the distinction between:
  - descriptor / transport binding module loading
  - precompiled workflow module loading
  - `.ts` workflow source compilation through
    `@tisyn/compiler`
- Keep imported source material separate from the derived
  handoff; do not overwrite `specs/tisyn-cli-module-loading-merge.md`.
- If the cleanup targets from the merge note are not
  actually present in this repo, do nothing. Do not create
  delete-only churn for absent files.

## Concrete Work

### 1. Merge the CLI spec amendment

Update `specs/tisyn-cli-specification.md` to match the
imported merge note:

- bump version from `0.3.4` to `0.4.0`
- replace §1.2 responsibility text
- replace §10.1 step 1
- replace §10.1 step 2
- replace the local/inprocess binding paragraph in §10.1
  step 10
- insert new §10.5 before §11

Do not broaden the edit beyond what the imported note
calls for unless a local cross-reference breaks.

### 2. Extract a shared bootstrap loader

Create a small CLI-internal helper used by pre-scope
module-loading sites. It should:

- accept a resolved file path
- support `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`
- reject `.tsx`
- lazily import `tsx/esm/api` only for TypeScript-family
  files
- use native `import()` for JavaScript-family files

The helper should be factored so the bootstrap path and
any future scoped runtime hook could delegate to the same
implementation, but do not add the runtime hook here.

### 3. Refactor the CLI call sites to use the helper

Update:

- `packages/cli/src/load-descriptor.ts`
- `packages/cli/src/startup.ts`
- `packages/cli/src/run.ts`
- `packages/cli/src/check.ts`

Required behavior:

- descriptor modules load through the shared helper
- local/inprocess transport binding modules load through
  the shared helper
- precompiled workflow modules load through the shared
  helper when the target is JavaScript-family
- `.ts` / `.mts` / `.cts` workflow source targets still
  go through compiler-based source compilation, not module
  evaluation
- same-module workflow export lookup still works when the
  descriptor itself is TypeScript

The current `workflowPath.endsWith(".ts")` check is too
narrow once `.mts` and `.cts` become first-class inputs.
Centralize extension handling so the run/check paths do
not drift.

### 4. Tighten module-loading diagnostics

Align user-visible failures with the merged spec where
practical:

- unsupported extension -> exit code 3
- missing module / unreadable path -> exit code 3
- TypeScript loader bootstrap failure -> exit code 3
- module evaluation failure -> exit code 3
- missing default export / invalid descriptor / missing
  named export -> exit code 2

Important nuance:

- keep workflow source compilation separate from module
  loading
- if compiler-based workflow source compilation still uses
  a different exit code for compile failure today, either
  preserve that intentionally with tests or update the spec
  touch points coherently; do not blur the two paths by
  accident

### 5. Add focused tests

Primary coverage should land close to existing CLI tests in
`packages/cli/src/cli.test.ts`, with smaller unit tests if
that is cleaner.

Minimum useful coverage:

- shared loader loads a `.js` module
- shared loader loads a `.ts` module
- shared loader rejects unsupported extension
- `tsn run` accepts a TypeScript descriptor module
- `tsn check` accepts a TypeScript descriptor module
- local/inprocess transport binding loading accepts
  TypeScript modules
- existing JavaScript descriptor workflow remains
  unchanged
- a missing TypeScript descriptor reports a clear
  not-found diagnostic

If `tsx` exposes stable enough error data in tests, add one
syntax-error assertion. Keep it resilient; do not overfit
to exact esbuild wording.

### 6. Package metadata and docs

Update `packages/cli/package.json` so `tsx` is a direct
dependency of `@tisyn/cli`, not just a root devDependency.

Then audit the CLI README/spec references that would be
misleading after this change. Keep doc edits tight to the
public surface.

## Files To Read First

- `specs/tisyn-cli-module-loading-merge.md`
- `specs/tisyn-cli-specification.md`
- `packages/cli/src/load-descriptor.ts`
- `packages/cli/src/startup.ts`
- `packages/cli/src/run.ts`
- `packages/cli/src/check.ts`
- `packages/cli/src/cli.test.ts`
- `packages/cli/package.json`

## Suggested Prompt

Implement the CLI module-loading merge on this branch.
Start by updating `specs/tisyn-cli-specification.md` to
match `specs/tisyn-cli-module-loading-merge.md`, then add
a shared CLI-internal bootstrap loader for `.ts`/`.mts`/
`.cts` and `.js`/`.mjs`/`.cjs` modules, refactor CLI
descriptor/workflow/transport call sites to use it,
preserve compiler-based source compilation for TypeScript
workflow source files, add focused CLI tests, and update
`packages/cli/package.json` so `tsx` is a direct
dependency of `@tisyn/cli`. Keep the future `Runtime`
context API out of scope on this branch unless a concrete
existing caller forces it.

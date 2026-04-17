# Specification System V2 — Agent Handoff

You are working in:

`/Users/tarasmankovski/Repositories/cowboyd/tisyn/worktrees/spec-system-v2-handoff`

Branch:

`spec-system-v2-handoff`

## Source Docs

Read these first:

- `tisyn-spec-system-specification.source.md`
- `tisyn-spec-system-test-plan.source.md`

Prep already completed:

- `origin` was fetched before creating this worktree.
- Local `main` matched `origin/main` at `ca3f03f`.
- This branch was created from that updated `main` tip.
- The two source docs were imported from `/Users/tarasmankovski/Downloads`.

## What This Track Is

This is a follow-on spec-alignment track for `@tisyn/spec`.

It is not the original greenfield package bootstrap. `packages/spec`
already exists on `main`, but the imported v2 docs define a materially
different contract:

- scope-aware corpus acquisition from a static manifest
- a new registry shape and scope semantics
- query families for lookup, listing, relationship, analysis, and projection
- context-assembly APIs
- explicit workflow contracts built on acquire -> assemble -> return
- discovery-pack typed output plus optional text rendering

Treat this branch as a breaking realignment toward the imported docs,
not as a small additive patch.

## Current Repo Facts

- `packages/spec` already exists on `main`.
- The current package models a different schema:
  - top-level `version`
  - `dependsOn` / `amends` / `complements` / `implements`
  - top-level `rules`, `errorCodes`, `concepts`, `invariants`, `terms`
  - no `registry.scope`
  - no manifest acquisition API
- The imported v2 docs instead center on:
  - `relationships`
  - section-contained authored content
  - `openQuestions`
  - `buildRegistry(modules, scope)`
  - `acquireCorpusRegistry(scope?)`
  - pure query and context-assembly layers
- Current public exports already include Markdown rendering and
  `verify-corpus`, but do not expose the v2 query/context surface.
- `packages/spec/package.json` currently has workspace runtime deps on
  other `@tisyn/*` packages. The imported v2 spec says the package
  should have zero `@tisyn/*` runtime dependencies.
- The structured CLI corpus in `packages/spec/corpus/tisyn-cli` and the
  generated docs in `specs/tisyn-cli-*.md` are useful reference data,
  but they are authored against the current pre-v2 schema.

## Consequences

Do not frame this as "add a couple of new functions." The imported docs
change the data model and several public return types.

Concrete mismatches on `main` that must be resolved:

- `buildRegistry(...)` currently takes separate spec/plan arrays; v2
  requires a mixed module array plus explicit scope annotation.
- `checkCoverage(...)` and `isReady(...)` currently return shapes that do
  not match v2's `CoverageResult` and `ReadinessResult`.
- Manifest acquisition and auxiliary acquisition APIs are missing.
- The lookup/listing/relationship/projection query families are missing.
- Context-assembly APIs are missing.
- Existing workflows are not yet organized around the explicit
  `acquireCorpusRegistry()` -> pure assembly -> typed return contract.

## Working Assumption

Unless a concrete downstream caller proves otherwise, prefer replacing
obsolete `@tisyn/spec` surface to match the imported v2 docs rather than
building a broad compatibility layer over the current package.

Why:

- the authored schema is substantially different
- the registry contract changed
- the query layer is new, not just renamed
- carrying both shapes will increase confusion and test burden fast

Audit callers first, but expect most adaptation to stay inside
`packages/spec`.

## Recommended First Pass

1. Audit current `@tisyn/spec` consumers and list which ones are real
   keepers versus artifacts of the old implementation.
2. Lock the v2 canonical type surface from the imported spec:
   - modules
   - relationships
   - indices
   - scope types
   - coverage/readiness/query result types
3. Rebuild normalization and registry around the v2 contracts, including:
   - immutable returned registry
   - scope annotation
   - dependency order
   - complete indices
4. Add the query layer and drive it from the imported P0 tests.
5. Add context-assembly functions as pure composition over those queries.
6. Rework workflow entrypoints so analytical steps go through
   `acquireCorpusRegistry()` and context assembly instead of ad hoc logic.
7. Preserve or port rendering/compare support only where it still matches
   the imported rendering contract.

## Manifest And Workflow Guidance

- Acquisition must use a static manifest. Do not use directory scanning as
  runtime discovery.
- Keep acquisition as the effectful boundary; queries and context assembly
  stay pure.
- Auxiliary inputs such as frozen fixtures and committed Markdown are not
  part of the registry.
- If `verify-corpus` survives, port it onto the v2 acquisition contract
  instead of keeping a parallel loading path.

## Dependency Tension To Resolve Early

The imported spec says `@tisyn/spec` has zero `@tisyn/*` runtime
dependencies, but the workflow section still points at
`packages/spec/workflows/*.ts` runnable through `tsn run`.

Recommended default:

- keep `packages/spec/src` dependency-free and spec-conformant
- avoid coupling the core library to agent/CLI/transport packages
- if workflow descriptors require runtime deps, either:
  - move them out of the published package surface, or
  - split core library and workflow package before calling the track done

Do not ignore this mismatch and ship a package that silently violates the
source doc.

## Non-Goals

Do not spend time on these unless the imported docs explicitly force them:

- compatibility shims for the old schema beyond what live callers need
- directory-scanning acquisition
- query DSL or hosted graph service
- prose-only fixes that do not move the implementation toward v2
- broad repo refactors unrelated to `@tisyn/spec`

## Verification Targets

Primary:

```bash
pnpm --filter @tisyn/spec test
```

Secondary:

```bash
pnpm --filter @tisyn/spec build
```

If you touch workflow consumers outside the package, run the narrowest
additional checks needed for those callers.

## Done Means

The branch is in good shape when a reader can verify that:

- the imported source docs are present in this worktree
- `packages/spec` aligns with the v2 data model and registry contract
- acquisition is manifest-based and scope-aware
- the query families and context-assembly APIs exist and are tested
- workflows use acquire -> assemble -> typed return
- rendering remains a derived projection, not canonical state
- the package boundary is honest about the zero-runtime-deps claim

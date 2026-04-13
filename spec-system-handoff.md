# Specification System — Agent Handoff

You are working in:

`/Users/tarasmankovski/Repositories/cowboyd/tisyn/worktrees/spec-system-handoff`

Branch:

`spec-system-handoff`

## Source Docs

Read these first:

- `spec-system-specification.source.md` — normative draft for the `@tisyn/spec` package
- `spec-system-test-plan.source.md` — conformance test plan for the same package

The main prep has already been done:

- `origin` was fetched before creating this worktree.
- Local `main` matched `origin/main` at `14917df`.
- This branch was created from that updated `main` tip.
- The two draft docs were imported from `/Users/tarasmankovski/Downloads`.

## What This Track Is

This is a new package track for `@tisyn/spec`.

It is not a rewrite of the existing root-level system spec in:

- `specs/tisyn-system-specification.md`

The imported docs define a package that manages the specification corpus itself:

- authored TypeScript DSL constructors
- normalization into committed JSON artifacts
- registry construction from normalized artifacts
- validation, coverage, and readiness queries
- traversal helpers over authored module data

## Current Repo Facts

- There is currently no `packages/spec`.
- The workspace already includes `packages/*` in `pnpm-workspace.yaml`, so a new package directory will be picked up automatically.
- Existing package shape is conventional: `package.json`, `tsconfig.json`, `README.md`, `src/index.ts`, and colocated tests.
- `packages/config` is the closest structural reference for a typed-data package with constructors, validation, and traversal helpers.
- The imported spec explicitly says MVP has zero `@tisyn/*` dependencies. Do not add a dependency on other Tisyn packages unless you first prove the spec requires it.

## Implementation Defaults

- Implement this as a standalone `packages/spec` package.
- Treat the imported spec and test plan as the implementation authority for this branch.
- Keep the data domain fully serializable plain data:
  - no functions in emitted data
  - no class instances
  - no `undefined`, `NaN`, `Infinity`, `Symbol`, `BigInt`, or cyclic structures
- Use the `tisyn_spec` discriminant family from the imported spec, not the existing `tisyn` or `tisyn_config` discriminants.
- Keep enums string-backed and JSON-stable.
- Build normalization, registry, validation, coverage, readiness, and traversal as ordinary library APIs, not CLI commands.
- Prefer explicit structured report types over throwing for ordinary validation findings.

## MVP Scope To Implement

Implement the public API surface described in the source spec:

1. Authoring API
   - types
   - string-backed enums
   - PascalCase constructors
2. Build API
   - `normalizeSpec(...)`
   - `normalizeTestPlan(...)`
   - artifact-staleness comparison helper if needed to satisfy the determinism rules
3. Registry API
   - registry construction from normalized artifacts only
   - computed indices needed for validation/coverage/readiness
4. Validation API
   - `validateCorpus(...)`
   - `checkCoverage(...)`
   - `isReady(...)`
5. Traversal API
   - helpers such as `walkSections()`, `collectRules()`, `collectErrorCodes()`, and `collectTerms()`

## Explicit Non-Goals

Do not implement in this branch unless the scope is explicitly reopened:

- rendered markdown generation
- CLI commands or repo-wide spec tooling commands
- public graph-query / impact-analysis APIs
- constraint-document generation
- graph visualization
- migration tooling from markdown to TypeScript DSL
- semver-range dependency constraints between specs
- any change that rewrites or reinterprets the existing Tisyn runtime/compiler specs

## First Implementation Pass

1. Scaffold `packages/spec` with package metadata, tsconfig, README, entrypoint, and test runner wiring.
2. Add the core authored data model:
   - module types
   - section/rule/error-code/test-plan types
   - relationship types
   - coverage and ambiguity types
   - string enums
   - constructors
3. Add constructor and serializable-domain tests first. Use the imported test plan IDs and expectations as the backbone.
4. Implement normalization for spec and test-plan modules, including:
   - structural validation
   - section numbering
   - rule-location indexing
   - deterministic hashing
   - `_normalizedAt`
5. Implement registry construction purely from normalized artifacts.
6. Implement validation groups, coverage calculation, readiness checks, and traversal helpers.
7. Add README/package docs once the public API is stable enough to describe honestly.

## Important Boundaries

- Do not overwrite or rename `specs/tisyn-system-specification.md`; this branch is about a new spec-management package, not the core language spec.
- Do not expose public graph APIs just because the registry internally computes graph-shaped indices.
- Do not make registry/validation depend on reloading source modules after normalization. Registry input is normalized artifacts.
- Do not add cross-package coupling to runtime/compiler/kernel/transport just because this repo already contains those layers.
- Keep temporary handoff notes in this worktree, not in `.reviewer/`.

## Verification

Primary gate once the package exists:

```bash
pnpm --filter @tisyn/spec test
```

Secondary gate:

```bash
pnpm --filter @tisyn/spec build
```

If repo-level docs are updated, also run the relevant broader checks you touch, but keep the first pass centered on the new package.

## Deliverables

Produce:

1. The imported source docs kept in this worktree.
2. A new `packages/spec` package implementing the MVP public API from the source spec.
3. Tests that trace back cleanly to the imported conformance plan.
4. A short implementation summary that calls out any remaining ambiguities or intentionally deferred items.

## Done Means

The branch is done when a reader can verify that:

- `@tisyn/spec` exists as a standalone workspace package
- constructor outputs and normalized artifacts are serializable plain data
- normalization is deterministic apart from `_normalizedAt`
- registry construction depends only on normalized artifacts
- validation, coverage, readiness, and traversal APIs exist and are tested
- the branch stayed within MVP scope and did not drift into CLI/rendering/graph tooling

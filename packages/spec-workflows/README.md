# `@tisyn/spec-workflows`

`@tisyn/spec-workflows` packages the authored workflows used to draft, amend, review, and verify the Tisyn specification corpus.

It exists because the corpus pipeline needs workflow-shaped entrypoints and agent wiring that sit above `@tisyn/spec`'s pure data/model logic. `@tisyn/spec` knows how to acquire, assemble, compare, and validate corpus data; this package turns that capability into runnable workflows and workflow-local bindings.

## Where It Fits

`@tisyn/spec-workflows` sits above the corpus library and below operator-facing CLI runs.

- `@tisyn/spec` owns corpus acquisition, comparison, readiness, and authoring-context assembly.
- `@tisyn/config` supplies the workflow descriptors and runtime wiring vocabulary.
- `@tisyn/agent`, `@tisyn/transport`, and `@tisyn/claude-code` provide the capability boundaries these workflows call through.
- `@tisyn/cli` executes these workflows through `tsn run`.

Use this package when you want to run the spec-authoring pipeline itself, not when you just need the underlying corpus library APIs.

## What It Provides

The public surface exported from `src/index.ts` includes:

- `draftSpec` — assemble authoring context for a new or expanded spec
- `amendSpec` — assemble amendment context for an existing spec/section
- `reviewSpec` — assemble review context for a target spec
- `draftTestPlan` — assemble authoring context for a test plan
- `consistencyCheck` — run a consistency-oriented assembly/check workflow

These are the simple acquire-and-assemble workflows intended to be imported as library entrypoints.

## Workflow Modules vs. Exported Helpers

This package also contains full workflow descriptor modules that are intentionally not re-exported from `src/index.ts`, such as:

- `verify-corpus.ts`
- `claude-reviewer.ts`
- `filesystem-agent.ts`
- `corpus-agent.ts`
- `output-agent.ts`

Those files are meant to be executed directly with `tsn run` or loaded as workflow descriptors. They combine:

- authored generator bodies
- ambient agent contracts
- config/workflow descriptor wiring
- runtime journal and transport setup

Keeping them as direct workflow modules avoids pulling workflow-descriptor wiring into ordinary library imports.

## Relationship to Other Packages

- [`@tisyn/spec`](../spec/README.md) is the core corpus/model package this package orchestrates.
- [`@tisyn/config`](../config/README.md) defines the workflow descriptor vocabulary used by runnable workflow modules.
- [`@tisyn/claude-code`](../claude-code/README.md) provides the Claude-backed coding agent used by reviewer/verification flows.
- [`@tisyn/transport`](../transport/README.md) installs those bindings into execution scopes.
- [`@tisyn/agent`](../agent/README.md) provides the typed capability declarations used inside the workflows.

## Boundaries

`@tisyn/spec-workflows` does not:

- own the corpus data model
- replace the lower-level `@tisyn/spec` APIs
- define the general Tisyn runtime or transport systems

It exists to package the corpus-oriented workflows and the workflow-local wiring needed to run them.

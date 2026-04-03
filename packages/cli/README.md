# `@tisyn/cli`

`@tisyn/cli` is the command-line interface for the Tisyn workflow system. It compiles authored workflows into IR, validates descriptors, and executes workflows with full transport, journal, and server lifecycle management.

This package is the primary user-facing entry point for building and running Tisyn programs from the terminal.

## Where It Fits

`@tisyn/cli` sits at the top of the Tisyn stack, orchestrating build and execution workflows.

- `@tisyn/compiler` compiles authored workflow source into IR and generated modules.
- `@tisyn/config` defines the descriptor data model that `tsn run` and `tsn check` load.
- `@tisyn/runtime` executes compiled IR with replay, dispatch, and config resolution.
- `@tisyn/transport` provides the concrete transport factories installed during execution.

The CLI loads descriptors, resolves environment, installs transports, and hands execution off to the runtime.

## Core Concepts

### Two-phase parsing

`tsn run` uses a two-phase parsing model. Phase 1 parses built-in command options (`module`, `--entrypoint`, `--verbose`) via the CLI parsing library. Unrecognized flags remain in the remainder. Phase 2 loads the descriptor, resolves the workflow's input schema, and parses the remainder against derived workflow flags.

### Descriptor loading

A descriptor module's default export must be a `WorkflowDescriptor` (tagged with `tisyn_config: "workflow"`). The CLI resolves the workflow module path and export name from the descriptor's `run` field, then loads the compiled IR and input schema metadata.

### Invocation inputs

Workflow input parameters are derived from compiler-emitted `inputSchemas` metadata. Field names are converted from camelCase to kebab-case CLI flags. Supported field types: `string`, `number`, `boolean`.

### Resolved config

After overlay application and environment resolution, the projected configuration is passed to `execute()`. Workflows access it at runtime via `yield* useConfig(Token)`, where `Token` is a `ConfigToken<T>` that provides static typing.

## Installation

```bash
pnpm add @tisyn/cli
```

## Commands

### `tsn generate`

Compile one workflow source file into a generated TypeScript module.

```bash
tsn generate workflow.ts -o workflow.generated.ts
```

### `tsn build`

Run config-driven multi-pass generation from a `tisyn.config.ts` file.

```bash
tsn build
tsn build -c path/to/tisyn.config.ts
```

### `tsn run`

Load a workflow descriptor module, validate readiness, and execute the workflow.

```bash
tsn run ./descriptor.ts
tsn run ./descriptor.ts -e dev --max-turns 10
```

The `run` command:
1. Loads and validates the workflow descriptor (default export)
2. Applies an entrypoint overlay if `--entrypoint` is specified
3. Resolves the compiled workflow IR from the generated module
4. Parses CLI flags against the workflow's input schema metadata
5. Resolves environment variables from the process environment
6. Installs agent transports, starts servers, creates journal streams
7. Executes the workflow through `@tisyn/runtime`

### `tsn check`

Validate descriptor readiness without executing. Runs the same loading and validation as `run` but stops before starting transports or executing.

```bash
tsn check ./descriptor.ts
tsn check ./descriptor.ts -e staging
tsn check ./descriptor.ts --env-example
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Compilation error |
| 2 | Structural/validation error (invalid descriptor, bad export) |
| 3 | I/O error (module not found, import failure) |
| 4 | Input error (unknown flag, missing required, coercion failure) |
| 5 | Environment error (missing required/secret env variable) |
| 6 | Runtime execution error |

## Relationship to the Rest of Tisyn

- [`@tisyn/compiler`](../compiler/README.md) produces the generated modules and input schema metadata consumed by `tsn run`.
- [`@tisyn/config`](../config/README.md) defines the descriptor constructors and validation used by `tsn run` and `tsn check`.
- [`@tisyn/runtime`](../runtime/README.md) executes workflows and resolves config projections.
- [`@tisyn/transport`](../transport/README.md) provides transport factories installed during `tsn run`.
- [`@tisyn/durable-streams`](../durable-streams/README.md) provides the journal stream used during execution.

## Boundaries

`@tisyn/cli` owns:

- CLI argument parsing and command dispatch
- descriptor loading and validation
- two-phase input flag derivation and parsing
- transport, server, and journal lifecycle orchestration
- dynamic and static help generation

`@tisyn/cli` does not own:

- workflow compilation (owned by `@tisyn/compiler`)
- config resolution semantics (owned by `@tisyn/runtime`)
- IR evaluation or replay (owned by `@tisyn/runtime` and `@tisyn/kernel`)
- transport protocols or agent dispatch (owned by `@tisyn/transport` and `@tisyn/agent`)

## Summary

`@tisyn/cli` is the command-line entry point for building and running Tisyn workflows. It loads descriptors, derives input flags from compiled metadata, orchestrates runtime resources, and hands execution off to `@tisyn/runtime`.
